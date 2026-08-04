'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo, accesoModulosSession } from './auth'
import {
  construirPreview, construirCalendario, generarFacturasPeriodo, historialPorAcuerdo,
} from '@/lib/facturacion-suscripciones'
import { mapaTasas, monedaValida } from '@/lib/tasas'
import { parseNumeroEs } from '@/lib/numeros'
import { limiteDelFiltro, type FiltroListado } from '@/lib/listados'
import {
  clienteDeEmpresa, serviciosSuscribibles, crearAcuerdoSuscripcion, reanudarAcuerdo,
} from '@/lib/suscripciones-core'
import {
  estadoEfectivo, sumarPeriodo, hoyStr, generarLineaId, PERIODICIDADES,
  avanzarHasta, diaAnterior, calcularCobroAcuerdo,
  type PeriodicidadSub, type EstadoSub, type Suscripcion, type SuscripcionRow,
  type SuscripcionLineaRow,
  type SuscripcionesPageData, type FacturacionPreview, type CalendarioFacturacion,
  type DescuentoModo,
} from '@/lib/suscripciones'

// ── Obtener ───────────────────────────────────────────────────────────────────

/**
 * El listado de acuerdos, filtrado EN LA CONSULTA.
 *
 * Tres decisiones propias de este listado, distintas de los de Contabilidad:
 *
 *  · El rango es sobre **`fecha_proximo_cobro`**, no sobre `created_at`: la pregunta de
 *    esta pantalla es «qué cobro viene», no «qué se dio de alta».
 *  · **Por defecto NO hay rango**, como en CxC/CxP: un acuerdo vivo no puede desaparecer
 *    del listado por un filtro que nadie ha puesto.
 *  · El **techo sí se aplica siempre**. Con 53 acuerdos da igual; con 500 socios de
 *    gimnasio en 3G, no. Cuando se toca, se dice cuántos faltan.
 */
export async function obtenerSuscripciones(
  filtro?: FiltroListado,
): Promise<SuscripcionesPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const limite = limiteDelFiltro(filtro)

  let subQuery = db.from('suscripciones').select('*', { count: 'exact' })
    .eq('client_id', session.client_id)
  if (filtro?.desde) subQuery = subQuery.gte('fecha_proximo_cobro', filtro.desde)
  if (filtro?.hasta) subQuery = subQuery.lte('fecha_proximo_cobro', filtro.hasta)

  const [subRes, linRes, terRes, prodRes, monRes, empRes, acceso] = await Promise.all([
    subQuery
      .order('fecha_proximo_cobro', { ascending: true })   // lo que toca antes, antes
      .limit(limite),
    db.from('suscripcion_lineas').select('linea_id, suscripcion_id, producto_id, precio_mensual, descuento_modo, descuento_valor')
      .eq('client_id', session.client_id),
    db.from('third_parties').select('tercero_id, nombre, tipo, activo, empresa_id')
      .eq('client_id', session.client_id).order('nombre'),
    db.from('products').select('producto_id, nombre, precios, es_suscribible, periodicidad_defecto, estado')
      .eq('client_id', session.client_id).eq('tipo', 'SERVICIO').order('nombre'),
    db.from('monedas').select('codigo')
      .eq('client_id', session.client_id).eq('activa', true).order('codigo'),
    db.from('empresas').select('empresa_id, nombre, letra_facturacion')
      .eq('client_id', session.client_id).order('nombre'),
    accesoModulosSession(session),
  ])

  const terceros = (terRes.data ?? []) as {
    tercero_id: string; nombre: string; tipo: string; activo: boolean; empresa_id: string
  }[]
  const productos = (prodRes.data ?? []) as {
    producto_id: string; nombre: string; precios: Record<string, number> | null
    es_suscribible: boolean; periodicidad_defecto: string | null; estado: string
  }[]

  const nombreTercero  = new Map(terceros.map(t => [t.tercero_id, t.nombre]))
  const nombreServicio = new Map(productos.map(p => [p.producto_id, p.nombre]))
  const hoy = hoyStr()

  // Las líneas del acuerdo (mig. 124): un acuerdo puede prestar varios servicios.
  const lineasPorSub = new Map<string, SuscripcionLineaRow[]>()
  /** Servicios que algún acuerdo tiene contratados, se sigan ofreciendo o no. */
  const contratados = new Set<string>()
  for (const l of (linRes.data ?? []) as Record<string, unknown>[]) {
    const sid = l.suscripcion_id as string
    contratados.add(l.producto_id as string)
    const arr = lineasPorSub.get(sid) ?? []
    arr.push({
      linea_id:        l.linea_id as string,
      producto_id:     l.producto_id as string,
      precio_mensual:  Number(l.precio_mensual) || 0,
      descuento_modo:  (l.descuento_modo === 'MONTO_FIJO' ? 'MONTO_FIJO' : 'PORCENTAJE') as DescuentoModo,
      descuento_valor: Number(l.descuento_valor) || 0,
      servicio_nombre: nombreServicio.get(l.producto_id as string) ?? '—',
    })
    lineasPorSub.set(sid, arr)
  }

  const total = (subRes.count as number | null) ?? (subRes.data ?? []).length

  // Sus facturas: lo que convierte el listado en la respuesta a «¿me pagaron?». La cadena
  // ya existía entera (documento_lineas → facturas → cobros de Tesorería); solo faltaba
  // traerla a la pantalla del acuerdo.
  const historialDe = await historialPorAcuerdo(
    db, session.client_id,
    ((subRes.data ?? []) as Record<string, unknown>[]).map(s => s.suscripcion_id as string),
  )

  const suscripciones: SuscripcionRow[] = ((subRes.data ?? []) as Record<string, unknown>[]).map(s => {
    const row = {
      ...s,
      renovacion_automatica: Boolean(s.renovacion_automatica),
    } as Suscripcion
    const historial = historialDe.get(row.suscripcion_id) ?? []
    // La deuda por moneda. Vacío ≠ 0: sin facturas no se debe nada TODAVÍA, y un 0 diría
    // «está al día», que es la conclusión contraria (la regla del acta de conteo).
    const porMoneda = new Map<string, number>()
    for (const f of historial) {
      if (f.saldo > 0.005) porMoneda.set(f.moneda, (porMoneda.get(f.moneda) ?? 0) + f.saldo)
    }
    return {
      ...row,
      cliente_nombre:  nombreTercero.get(row.cliente_id) ?? '—',
      lineas:          (lineasPorSub.get(row.suscripcion_id) ?? [])
        .sort((a, b) => a.servicio_nombre.localeCompare(b.servicio_nombre)),
      estado_efectivo: estadoEfectivo(row, hoy),
      historial,
      debe: [...porMoneda.entries()].map(([moneda, total]) => ({
        moneda, total: Math.round(total * 100) / 100,
      })),
    }
  })

  // Tasas entre las monedas del cliente: el modal las usa para ofrecer la conversión
  // cuando el servicio no tiene tarifa en la moneda elegida (igual que el salario en
  // Personal). Son un puñado de pares: viajan con la página, no por ida y vuelta.
  const monedas = (monRes.data ?? []).map((m: { codigo: string }) => m.codigo)
  const tasas = monedas.length > 1 ? await mapaTasas(db, session.client_id, monedas) : {}

  return {
    suscripciones,
    rango:   { desde: filtro?.desde ?? '', hasta: filtro?.hasta ?? '' },
    total,
    limite,
    hay_mas: total > suscripciones.length,
    // Los terceros son POR EMPRESA (`third_parties.empresa_id` es NOT NULL): el mismo
    // negocio real puede tener una ficha en cada una. El selector las filtra por la
    // empresa elegida — si no, salen repetidos y se puede atar una suscripción de una
    // empresa a la ficha de otra.
    clientes: terceros
      .filter(t => t.activo && (t.tipo === 'CLIENTE' || t.tipo === 'AMBOS'))
      .map(t => ({ tercero_id: t.tercero_id, nombre: t.nombre, empresa_id: t.empresa_id })),
    // Los ofrecibles, MÁS los que algún acuerdo ya tiene contratados aunque hayan dejado
    // de serlo: el selector no puede borrar en silencio lo que la ficha guarda.
    servicios: productos
      .filter(p => (p.es_suscribible && p.estado === 'ACTIVO') || contratados.has(p.producto_id))
      .map(p => ({
        producto_id:          p.producto_id,
        nombre:               p.nombre,
        precios:              (typeof p.precios === 'object' && p.precios !== null) ? p.precios : {},
        periodicidad_defecto: (p.periodicidad_defecto as PeriodicidadSub | null) ?? null,
        archivado:            !(p.es_suscribible && p.estado === 'ACTIVO'),
      })),
    monedas,
    empresas: (empRes.data ?? []) as { empresa_id: string; nombre: string; letra_facturacion: string | null }[],
    tasas,
    tieneBase: acceso.visibles.includes('base'),
  }
}

// ── Guardar (crear / editar) ────────────────────────────────────────────────────

/**
 * Deja hecho el borrador del PRIMER cobro cuando el acuerdo nace ya vencido, en vez
 * de esperar al cron de mañana: si al dueño se le dice que la factura se genera sola,
 * ver un botón de «Generar» al terminar el alta es exactamente lo contrario.
 *
 * Acotado al cliente de ESTA suscripción (se excluye al resto del período): dar de alta
 * un acuerdo no puede facturarle de golpe a los demás clientes que tuvieran algo
 * pendiente ese mes. Y es silencioso: sin Contabilidad o sin letra de facturación no
 * hay factura posible, pero la suscripción se guarda igual y el cobro sigue su curso.
 */
async function borradorDelPrimerCobro(
  db: ReturnType<typeof createAdminClient>,
  clientId: string, empresa_id: string, cliente_id: string, moneda: string,
  fecha_proximo_cobro: string,
): Promise<string | null> {
  if (fecha_proximo_cobro > hoyStr()) return null      // aún no toca: ya lo hará el cron
  if (!(await puedeEditarModulo('base'))) return null   // facturar de verdad exige Contabilidad

  const { data: emp } = await db.from('empresas')
    .select('letra_facturacion').eq('empresa_id', empresa_id).eq('client_id', clientId).maybeSingle()
  const letra = emp?.letra_facturacion as string | undefined
  if (!letra) return null                               // sin letra no hay con qué numerar

  const periodo = fecha_proximo_cobro.slice(0, 7)
  const prev = await construirPreview(db, clientId, empresa_id, periodo)
  if (!prev.ok || !prev.preview) return null

  const mio = `${cliente_id}#${moneda}`
  const excluir = prev.preview.grupos.map(g => `${g.cliente_id}#${g.moneda}`).filter(k => k !== mio)
  if (excluir.length === prev.preview.grupos.length) return null   // no hay grupo mío que facturar

  const r = await generarFacturasPeriodo(db, clientId, empresa_id, letra, periodo, excluir)
  return r.numeros?.[0] ?? null
}

export async function guardarSuscripcion(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; suscripcion_id?: string; factura?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('servicios')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const g = (k: string) => ((formData.get(k) as string) ?? '').trim()

  const suscripcion_id_form = g('suscripcion_id')
  const cliente_id  = g('cliente_id')
  const empresa_id  = g('empresa_id')
  const moneda      = g('moneda')
  const periodicidad = g('periodicidad') as PeriodicidadSub
  const fecha_inicio = g('fecha_inicio')
  const fecha_proximo_cobro = g('fecha_proximo_cobro') || fecha_inicio
  const fecha_fin    = g('fecha_fin') || null
  const renovacion_automatica = g('renovacion_automatica') === '1'
  const notas = g('notas') || null
  // Prorrateo del PRIMER período (mig. 163). Opt-in por acuerdo: el default reproduce
  // exactamente el comportamiento anterior (ciclo completo).
  const prorratear = g('prorratear') === '1'
  /**
   * «No generes la factura todavía». El borrador del primer cobro es lo normal —el
   * acuerdo nace ya vencido en el caso por defecto—, pero un alta que migra un histórico,
   * o un alta de veinte clientes de golpe, puede no querer veinte documentos el mismo
   * día. **No es una fuga de dinero**: la facturación automática es permanente, así que
   * el cron lo genera igual mañana en su mes.
   */
  const sinBorrador = g('sin_borrador') === '1'

  // Los servicios del acuerdo viajan como JSON: [{ producto_id, precio_mensual,
  // descuento_modo, descuento_valor }]. El descuento es de CADA servicio (mig. 125).
  //
  // `parseNumeroEs` y no `Number()`: los importes llegan **tal como se teclearon**, y en
  // un teclado español «0,5» con `Number()` es NaN → 0 y «1.500,50» es NaN → 0. El
  // candado va aquí, en el servidor, no en el input: es la lección literal de la Fase 1
  // de Inventario — el formulario no es la única vía de escritura.
  let lineas: { producto_id: string; precio_mensual: number; descuento_modo: DescuentoModo; descuento_valor: number }[] = []
  try {
    const raw = JSON.parse(g('lineas') || '[]')
    if (Array.isArray(raw)) {
      lineas = raw
        .map((l: Record<string, unknown>) => ({
          producto_id:     String(l?.producto_id ?? '').trim(),
          precio_mensual:  parseNumeroEs(l?.precio_mensual as string | number),
          descuento_modo:  (l?.descuento_modo === 'MONTO_FIJO' ? 'MONTO_FIJO' : 'PORCENTAJE') as DescuentoModo,
          descuento_valor: parseNumeroEs(l?.descuento_valor as string | number),
        }))
        .filter(l => l.producto_id)
    }
  } catch { /* lineas queda vacío y lo caza la validación */ }

  if (!cliente_id)  return { ok: false, error: 'Elige el cliente.' }
  if (!lineas.length) return { ok: false, error: 'Añade al menos un servicio.' }
  if (!empresa_id)  return { ok: false, error: 'Elige la empresa.' }
  if (!fecha_inicio) return { ok: false, error: 'La fecha de inicio es obligatoria.' }
  if (!PERIODICIDADES.includes(periodicidad)) return { ok: false, error: 'Periodicidad inválida.' }
  if (lineas.some(l => l.precio_mensual < 0)) return { ok: false, error: 'El precio no puede ser negativo.' }
  if (lineas.some(l => l.descuento_valor < 0)) return { ok: false, error: 'El descuento no puede ser negativo.' }
  if (lineas.some(l => l.descuento_modo === 'PORCENTAJE' && l.descuento_valor > 100))
    return { ok: false, error: 'Un descuento en porcentaje no puede pasar del 100 %.' }

  const db = createAdminClient()

  // La moneda SIEMPRE de las del cliente (nunca lista fija): una que no tiene no
  // cotiza y descuadraría la facturación.
  if (!(await monedaValida(db, session.client_id, moneda)))
    return { ok: false, error: 'Elige una moneda activa del negocio.' }

  // Todos los servicios deben ser SERVICIOS suscribibles del cliente. Se comprueban
  // los del formulario contra la base de una vez: la lista del navegador no es
  // control de acceso, y aquí se cuelan `producto_id` por POST igual que uno solo.
  const validos = await serviciosSuscribibles(db, session.client_id, lineas.map(l => l.producto_id))
  if (lineas.some(l => !validos.has(l.producto_id)))
    return { ok: false, error: 'Algún servicio elegido no es suscribible.' }

  // El cliente tiene que ser de ESA empresa. Los terceros son por empresa, así que sin
  // esta guardia se podía atar una suscripción de la Empresa 1 a la ficha de la Empresa 3
  // y la factura —que sí pertenece a una empresa— saldría a nombre de un tercero ajeno.
  if (!(await clienteDeEmpresa(db, session.client_id, cliente_id, empresa_id)))
    return { ok: false, error: 'Ese cliente no es de la empresa elegida.' }

  const campos = {
    empresa_id, cliente_id, moneda, periodicidad,
    fecha_inicio, fecha_proximo_cobro,
    fecha_fin, renovacion_automatica, notas, prorratear,
    updated_at: new Date().toISOString(),
  }

  /** Reescribe las líneas del acuerdo: se borran y se vuelven a insertar, como hacen
   *  las líneas de una factura al guardarla. */
  async function escribirLineas(suscripcion_id: string, clientId: string) {
    await db.from('suscripcion_lineas').delete()
      .eq('suscripcion_id', suscripcion_id).eq('client_id', clientId)
    return db.from('suscripcion_lineas').insert(lineas.map(l => ({
      linea_id:        generarLineaId(),
      client_id:       clientId,
      suscripcion_id,
      producto_id:     l.producto_id,
      precio_mensual:  l.precio_mensual,
      descuento_modo:  l.descuento_modo,
      descuento_valor: l.descuento_valor,
    })))
  }

  if (!suscripcion_id_form) {
    let suscripcion_id: string
    try {
      suscripcion_id = await crearAcuerdoSuscripcion(db, session.client_id, campos)
    } catch (e) {
      console.error('[suscripciones] insert:', e)
      return { ok: false, error: `Error al crear: ${(e as Error).message}` }
    }

    const { error: errLin } = await escribirLineas(suscripcion_id, session.client_id)
    if (errLin) {
      // Un acuerdo sin líneas no se puede cobrar y no se ve: mejor deshacerlo que
      // dejar una fila fantasma en la lista.
      await db.from('suscripciones').delete().eq('suscripcion_id', suscripcion_id).eq('client_id', session.client_id)
      console.error('[suscripciones] insert lineas:', errLin)
      return { ok: false, error: 'Error al guardar los servicios del acuerdo.' }
    }

    // El acuerdo ya existe y está bien: lo que venga de aquí no puede tumbarlo.
    let factura: string | null = null
    try {
      if (!sinBorrador) factura = await borradorDelPrimerCobro(
        db, session.client_id, empresa_id, cliente_id, moneda, fecha_proximo_cobro,
      )
    } catch (e) {
      console.error('[suscripciones] borrador del primer cobro:', e)
    }

    revalidatePath('/portal/suscripciones')
    if (factura) revalidatePath('/portal/ventas')
    return { ok: true, suscripcion_id, factura: factura ?? undefined }
  }

  const { error } = await db.from('suscripciones')
    .update(campos)
    .eq('suscripcion_id', suscripcion_id_form)
    .eq('client_id', session.client_id)
  if (error) { console.error('[suscripciones] update:', error); return { ok: false, error: 'Error al actualizar.' } }

  const { error: errLin } = await escribirLineas(suscripcion_id_form, session.client_id)
  if (errLin) { console.error('[suscripciones] update lineas:', errLin); return { ok: false, error: 'Error al guardar los servicios del acuerdo.' } }

  revalidatePath('/portal/suscripciones')
  return { ok: true, suscripcion_id: suscripcion_id_form }
}

// ── Cambiar estado (pausar / reanudar / cancelar) ───────────────────────────────

/**
 * Cambia el estado de un acuerdo **y su calendario de cobro con él** (mig. 161).
 *
 * Antes solo tocaba `estado`, y ahí estaba el fallo de fondo del ciclo de vida: pausar
 * dejaba `fecha_proximo_cobro` quieta, así que al reanudar salía un cobro atrasado por
 * cada mes de pausa. Cada estado tiene su efecto sobre el calendario:
 *
 *   · PAUSADA   → registra desde cuándo (y hasta cuándo, si se programa).
 *   · ACTIVA    → reanuda: salta los ciclos que cayeron dentro de la pausa.
 *   · CANCELADA → sella `cancelada_at`, que es lo que cuenta las bajas del mes.
 */
/**
 * El mismo acuerdo para VARIOS clientes de una vez.
 *
 * Es cómo crece de verdad un negocio de cuotas: el partner con 53 acuerdos casi idénticos
 * los metió por el importador porque desde la UI no había forma. Aquí cada cliente
 * produce un acuerdo propio (precio y condiciones iguales, ficha suya), no un acuerdo
 * compartido.
 *
 * **Reutiliza `guardarSuscripcion` cliente a cliente en vez de reimplementarla**: así
 * hereda TODAS sus guardias (moneda del negocio, servicio suscribible, cliente de esa
 * empresa) y su efecto secundario —el borrador del primer cobro— sin poder divergir. Es
 * también la razón de que la UI exija previsualización: `borradorDelPrimerCobro` corre
 * por acuerdo, así que un clic sin aviso puede dejar 30 facturas borrador.
 *
 * Un fallo no aborta el lote: se reporta con el patrón `ResultadoLote` (hechas / omitidas
 * con su motivo), como el resto de acciones en lote del portal.
 */
export async function crearSuscripcionesEnLote(
  formData: FormData, clienteIds: string[],
): Promise<{ ok: boolean; hechas: number; facturas: number; omitidas: { nombre: string; motivo: string }[]; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, hechas: 0, facturas: 0, omitidas: [], error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('servicios')))
    return { ok: false, hechas: 0, facturas: 0, omitidas: [], error: 'No tienes permiso para editar en este módulo.' }

  const ids = [...new Set(clienteIds.filter(Boolean))]
  if (!ids.length) return { ok: false, hechas: 0, facturas: 0, omitidas: [], error: 'Elige al menos un cliente.' }

  const db = createAdminClient()
  const { data: terc } = await db.from('third_parties')
    .select('tercero_id, nombre').eq('client_id', session.client_id).in('tercero_id', ids)
  const nombreDe = new Map(((terc ?? []) as { tercero_id: string; nombre: string }[])
    .map(t => [t.tercero_id, t.nombre]))

  let hechas = 0, facturas = 0
  const omitidas: { nombre: string; motivo: string }[] = []
  for (const cliente_id of ids) {
    // Copia del formulario con SU cliente: nunca se arrastra un `suscripcion_id`, que
    // convertiría el alta en una edición del mismo acuerdo una y otra vez.
    const fd = new FormData()
    for (const [k, v] of formData.entries()) {
      if (k === 'suscripcion_id' || k === 'cliente_id') continue
      fd.set(k, v)
    }
    fd.set('cliente_id', cliente_id)

    const r = await guardarSuscripcion(fd)
    if (r.ok) { hechas++; if (r.factura) facturas++ }
    else omitidas.push({ nombre: nombreDe.get(cliente_id) ?? cliente_id, motivo: r.error ?? 'No se pudo crear' })
  }

  revalidatePath('/portal/suscripciones')
  if (facturas) revalidatePath('/portal/ventas')
  return { ok: true, hechas, facturas, omitidas }
}

export async function cambiarEstadoSuscripcion(
  suscripcion_id: string, estado: EstadoSub,
  opciones?: {
    /** PAUSADA: reanudación programada (vacío = indefinida). */
    pausada_hasta?: string | null
    /** ACTIVA: la casilla de escape — cobrar también los meses pausados. */
    cobrarPausados?: boolean
  },
): Promise<{ ok: boolean; error?: string; ciclosSaltados?: number; proximoCobro?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('servicios')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!['ACTIVA', 'PAUSADA', 'CANCELADA'].includes(estado))
    return { ok: false, error: 'Estado inválido.' }

  const db  = createAdminClient()
  const hoy = hoyStr()

  const { data: s } = await db.from('suscripciones')
    .select('suscripcion_id, periodicidad, fecha_proximo_cobro, pausada_desde')
    .eq('suscripcion_id', suscripcion_id).eq('client_id', session.client_id).maybeSingle()
  if (!s) return { ok: false, error: 'Suscripción no encontrada.' }

  // Reanudar es la única transición con aritmética: va por el núcleo que comparte con el
  // escáner del cron, para que las dos vías decidan lo mismo.
  if (estado === 'ACTIVA') {
    try {
      // Se devuelve lo que de VERDAD se aplicó (el servidor tiene su propio «hoy»), para
      // que el aviso al dueño no sea la promesa del diálogo sino el resultado.
      const plan = await reanudarAcuerdo(db, session.client_id, {
        suscripcion_id:      s.suscripcion_id as string,
        periodicidad:        s.periodicidad as PeriodicidadSub,
        fecha_proximo_cobro: s.fecha_proximo_cobro as string,
        pausada_desde:       (s.pausada_desde as string | null) ?? null,
      }, hoy, opciones?.cobrarPausados === true)
      revalidatePath('/portal/suscripciones')
      return { ok: true, ciclosSaltados: plan.ciclos, proximoCobro: plan.proximoCobro }
    } catch {
      return { ok: false, error: 'No se pudo reanudar.' }
    }
  }

  const campos: Record<string, unknown> = { estado, updated_at: new Date().toISOString() }
  if (estado === 'PAUSADA') {
    campos.pausada_desde = hoy
    campos.pausada_hasta = opciones?.pausada_hasta || null
  }
  if (estado === 'CANCELADA') campos.cancelada_at = new Date().toISOString()

  const { error } = await db.from('suscripciones')
    .update(campos)
    .eq('suscripcion_id', suscripcion_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo cambiar el estado.' }
  revalidatePath('/portal/suscripciones')
  return { ok: true }
}

/**
 * Cancelar **al final del período pagado**, que es como se cancela un contrato normal:
 * el cobro en curso ya está hecho y el acuerdo deja de renovarse cuando se agote.
 *
 * **Cero columnas nuevas**: es `fecha_fin = fecha_proximo_cobro − 1 día` +
 * `renovacion_automatica = false`. El estado efectivo pasa a VENCIDA solo (se DERIVA),
 * el preview deja de ofrecerla y el resto del módulo ya lo entiende. Un flag
 * `cancelar_al_final` sería un segundo sitio donde vive la misma verdad.
 */
export async function cancelarAlFinalDelPeriodo(
  suscripcion_id: string,
): Promise<{ ok: boolean; error?: string; fecha_fin?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('servicios')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: s } = await db.from('suscripciones')
    .select('fecha_proximo_cobro, estado')
    .eq('suscripcion_id', suscripcion_id).eq('client_id', session.client_id).maybeSingle()
  if (!s) return { ok: false, error: 'Suscripción no encontrada.' }
  if (s.estado === 'CANCELADA') return { ok: false, error: 'Ya está cancelada.' }

  const fecha_fin = diaAnterior(s.fecha_proximo_cobro as string)
  const { error } = await db.from('suscripciones')
    .update({ fecha_fin, renovacion_automatica: false, updated_at: new Date().toISOString() })
    .eq('suscripcion_id', suscripcion_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo programar la baja.' }
  revalidatePath('/portal/suscripciones')
  return { ok: true, fecha_fin }
}

// ── Subida de tarifa en lote ─────────────────────────────────────────────────
//
// El caso comercial del modelo: hoy subirle el precio a 30 socios son 30 ediciones a
// mano. Cuatro reglas lo hacen seguro, y ninguna es opcional:
//
//  1. **No toca los borradores ya generados.** Una factura de julio ya creada se corrige
//     o se borra desde Ventas; la subida aplica DESDE EL SIGUIENTE CICLO. Aquí solo se
//     tocan `suscripcion_lineas`, nunca `documento_lineas`.
//  2. **El descuento se mantiene tal cual.** Es una condición pactada aparte, no un
//     porcentaje del precio de lista: recalcularlo sería renegociar por la espalda.
//  3. **No toca `products.precios`.** La tarifa del catálogo y el precio pactado son
//     cosas distintas — es la invariante que sostiene el módulo entero.
//  4. Se **previsualiza** antes (`previsualizarSubidaTarifa`), acuerdo a acuerdo, con el
//     antes → después. Mismo patrón que el recálculo de nómina.

export interface LineaSubida {
  suscripcion_id: string
  cliente_nombre: string
  moneda:         string
  antes:          number
  despues:        number
  /** Lo que se cobrará en su ciclo tras la subida (con su descuento aplicado). */
  cobroDespues:   number
  periodicidad:   PeriodicidadSub
}

/** Aplica la subida a un precio mensual. `%` o importe, el mismo vocabulario del descuento. */
function precioSubido(actual: number, modo: 'PORCENTAJE' | 'IMPORTE', valor: number): number {
  const bruto = modo === 'PORCENTAJE' ? actual * (1 + valor / 100) : actual + valor
  // Nunca negativo: una «subida» de −200 sobre un precio de 100 deja el precio a 0, no
  // en números rojos.
  return Math.max(0, Math.round(bruto * 100) / 100)
}

/** El antes → después, SIN escribir nada. */
export async function previsualizarSubidaTarifa(
  suscripcionIds: string[], modo: 'PORCENTAJE' | 'IMPORTE', valor: number,
): Promise<{ ok: boolean; error?: string; lineas?: LineaSubida[] }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  const ids = [...new Set(suscripcionIds.filter(Boolean))]
  if (!ids.length) return { ok: false, error: 'Elige al menos un acuerdo.' }
  if (!Number.isFinite(valor) || valor === 0) return { ok: false, error: 'Escribe cuánto sube.' }

  const db = createAdminClient()
  const [{ data: subs }, { data: lins }, { data: terc }] = await Promise.all([
    db.from('suscripciones').select('suscripcion_id, cliente_id, moneda, periodicidad')
      .eq('client_id', session.client_id).in('suscripcion_id', ids),
    db.from('suscripcion_lineas').select('suscripcion_id, precio_mensual, descuento_modo, descuento_valor')
      .eq('client_id', session.client_id).in('suscripcion_id', ids),
    db.from('third_parties').select('tercero_id, nombre').eq('client_id', session.client_id),
  ])
  const nombreDe = new Map(((terc ?? []) as { tercero_id: string; nombre: string }[]).map(t => [t.tercero_id, t.nombre]))
  const porSub = new Map<string, { precio_mensual: number; descuento_modo: DescuentoModo; descuento_valor: number }[]>()
  for (const l of (lins ?? []) as Record<string, unknown>[]) {
    const sid = l.suscripcion_id as string
    const arr = porSub.get(sid) ?? []
    arr.push({
      precio_mensual:  Number(l.precio_mensual) || 0,
      descuento_modo:  (l.descuento_modo === 'MONTO_FIJO' ? 'MONTO_FIJO' : 'PORCENTAJE') as DescuentoModo,
      descuento_valor: Number(l.descuento_valor) || 0,
    })
    porSub.set(sid, arr)
  }

  const lineas: LineaSubida[] = []
  for (const sub of (subs ?? []) as Record<string, unknown>[]) {
    const suyas = porSub.get(sub.suscripcion_id as string) ?? []
    if (!suyas.length) continue
    const per    = sub.periodicidad as PeriodicidadSub
    const antes  = suyas.reduce((t, l) => t + l.precio_mensual, 0)
    // El descuento NO se recalcula: viaja igual a la línea nueva.
    const nuevas = suyas.map(l => ({ ...l, precio_mensual: precioSubido(l.precio_mensual, modo, valor) }))
    lineas.push({
      suscripcion_id: sub.suscripcion_id as string,
      cliente_nombre: nombreDe.get(sub.cliente_id as string) ?? '—',
      moneda:         sub.moneda as string,
      antes:          Math.round(antes * 100) / 100,
      despues:        Math.round(nuevas.reduce((t, l) => t + l.precio_mensual, 0) * 100) / 100,
      cobroDespues:   calcularCobroAcuerdo(nuevas, per).total,
      periodicidad:   per,
    })
  }
  lineas.sort((a, b) => a.cliente_nombre.localeCompare(b.cliente_nombre))
  return { ok: true, lineas }
}

/** Aplica la subida. Lo omitido se reporta con su motivo; un fallo no aborta el lote. */
export async function aplicarSubidaTarifa(
  suscripcionIds: string[], modo: 'PORCENTAJE' | 'IMPORTE', valor: number,
): Promise<{ ok: boolean; hechas: number; omitidas: { nombre: string; motivo: string }[]; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, hechas: 0, omitidas: [], error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('servicios')))
    return { ok: false, hechas: 0, omitidas: [], error: 'No tienes permiso para editar en este módulo.' }
  const ids = [...new Set(suscripcionIds.filter(Boolean))]
  if (!ids.length) return { ok: false, hechas: 0, omitidas: [], error: 'Elige al menos un acuerdo.' }
  if (!Number.isFinite(valor) || valor === 0) return { ok: false, hechas: 0, omitidas: [], error: 'Escribe cuánto sube.' }

  const db = createAdminClient()
  const { data: lins } = await db.from('suscripcion_lineas')
    .select('linea_id, suscripcion_id, precio_mensual')
    .eq('client_id', session.client_id).in('suscripcion_id', ids)

  const tocados = new Set<string>()
  const omitidas: { nombre: string; motivo: string }[] = []
  for (const l of (lins ?? []) as { linea_id: string; suscripcion_id: string; precio_mensual: number }[]) {
    const nuevo = precioSubido(Number(l.precio_mensual) || 0, modo, valor)
    const { error } = await db.from('suscripcion_lineas')
      .update({ precio_mensual: nuevo })
      .eq('linea_id', l.linea_id).eq('client_id', session.client_id)
    if (error) omitidas.push({ nombre: l.suscripcion_id, motivo: 'No se pudo actualizar' })
    else tocados.add(l.suscripcion_id)
  }

  revalidatePath('/portal/suscripciones')
  return { ok: true, hechas: tocados.size, omitidas }
}

// ── Renovar (reactivar y empujar el fin un período) ─────────────────────────────

export async function renovarSuscripcion(
  suscripcion_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('servicios')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: s } = await db.from('suscripciones')
    .select('periodicidad, fecha_fin, fecha_proximo_cobro')
    .eq('suscripcion_id', suscripcion_id).eq('client_id', session.client_id).maybeSingle()
  if (!s) return { ok: false, error: 'Suscripción no encontrada.' }

  // Reactivar; si tenía fin, se empuja un período desde el mayor de (fin, hoy).
  const per  = s.periodicidad as PeriodicidadSub
  const hoy  = hoyStr()
  const base = s.fecha_fin && (s.fecha_fin as string) > hoy ? (s.fecha_fin as string) : hoy
  const nuevaFin = s.fecha_fin ? sumarPeriodo(base, per) : null

  // Y el CALENDARIO con ella: resucitar un acuerdo de marzo dejaba `fecha_proximo_cobro`
  // en marzo, así que el cron facturaba marzo, abril y mayo de golpe el mismo día. Se
  // avanza al primer ciclo que llegue a hoy — los meses en que el acuerdo estuvo muerto
  // no se prestó nada, así que no se cobran.
  const proximo = avanzarHasta(s.fecha_proximo_cobro as string, per, hoy).fecha

  const { error } = await db.from('suscripciones')
    .update({
      estado: 'ACTIVA', fecha_fin: nuevaFin, fecha_proximo_cobro: proximo,
      cancelada_at: null, pausada_desde: null, pausada_hasta: null,
      updated_at: new Date().toISOString(),
    })
    .eq('suscripcion_id', suscripcion_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo renovar.' }
  revalidatePath('/portal/suscripciones')
  return { ok: true }
}

// ── Facturación del período (Fase D) ──────────────────────────────────────────
// El núcleo vive en `lib/facturacion-suscripciones.ts` porque el cron de facturación
// automática lo usa sin sesión. Aquí solo se resuelve quién eres y si puedes.

/** Previsualización de UN período (no escribe). Sirve con y sin Contabilidad. */
export async function previewFacturacion(
  empresa_id: string, periodo: string,
): Promise<{ ok: boolean; error?: string; preview?: FacturacionPreview }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  return construirPreview(createAdminClient(), session.client_id, empresa_id, periodo)
}

/**
 * El calendario de cobros completo de una empresa (atrasado + este mes + futuro). No
 * escribe nada; el futuro que devuelve es una estimación sin acciones.
 */
export async function obtenerCalendarioFacturacion(
  empresa_id: string,
): Promise<{ ok: boolean; error?: string; calendario?: CalendarioFacturacion }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  return construirCalendario(createAdminClient(), session.client_id, empresa_id)
}

/** Genera las facturas borrador del período. `excluir` = claves "clienteId#moneda". */
export async function facturarPeriodo(
  empresa_id: string, periodo: string, excluir: string[],
): Promise<{ ok: boolean; error?: string; generadas?: number; fallidas?: number }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base')))
    return { ok: false, error: 'Necesitas el módulo Contabilidad para facturar de verdad.' }

  const db = createAdminClient()

  // La empresa necesita letra de facturación. Se comprueba ANTES del bucle, no a
  // mitad, para no dejar medias facturas.
  const { data: emp } = await db.from('empresas')
    .select('letra_facturacion').eq('empresa_id', empresa_id).eq('client_id', session.client_id).maybeSingle()
  if (!emp?.letra_facturacion)
    return { ok: false, error: 'Asigna una letra de facturación a la empresa antes de facturar.' }

  const res = await generarFacturasPeriodo(
    db, session.client_id, empresa_id, emp.letra_facturacion as string, periodo, excluir,
  )
  if (!res.ok) return res
  if ((res.generadas ?? 0) === 0 && (res.fallidas ?? 0) === 0) {
    return { ok: false, error: 'No hay nada que facturar (¿lo desmarcaste todo?).' }
  }

  revalidatePath('/portal/suscripciones')
  revalidatePath('/portal/ventas')
  return res
}
