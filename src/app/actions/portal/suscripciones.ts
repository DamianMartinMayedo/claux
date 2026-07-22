'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo, accesoModulosSession } from './auth'
import { construirPreview, construirCalendario, generarFacturasPeriodo } from '@/lib/facturacion-suscripciones'
import { mapaTasas } from '@/lib/tasas'
import {
  estadoEfectivo, sumarPeriodo, hoyStr, generarSuscripcionId, generarLineaId, PERIODICIDADES,
  type PeriodicidadSub, type EstadoSub, type Suscripcion, type SuscripcionRow,
  type SuscripcionLineaRow,
  type SuscripcionesPageData, type FacturacionPreview, type CalendarioFacturacion,
  type DescuentoModo,
} from '@/lib/suscripciones'

// ── Obtener ───────────────────────────────────────────────────────────────────

export async function obtenerSuscripciones(): Promise<SuscripcionesPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const [subRes, linRes, terRes, prodRes, monRes, empRes, acceso] = await Promise.all([
    db.from('suscripciones').select('*')
      .eq('client_id', session.client_id)
      .order('created_at', { ascending: false }),   // más reciente primero
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
  for (const l of (linRes.data ?? []) as Record<string, unknown>[]) {
    const sid = l.suscripcion_id as string
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

  const suscripciones: SuscripcionRow[] = ((subRes.data ?? []) as Record<string, unknown>[]).map(s => {
    const row = {
      ...s,
      renovacion_automatica: Boolean(s.renovacion_automatica),
    } as Suscripcion
    return {
      ...row,
      cliente_nombre:  nombreTercero.get(row.cliente_id) ?? '—',
      lineas:          (lineasPorSub.get(row.suscripcion_id) ?? [])
        .sort((a, b) => a.servicio_nombre.localeCompare(b.servicio_nombre)),
      estado_efectivo: estadoEfectivo(row, hoy),
    }
  })

  // Tasas entre las monedas del cliente: el modal las usa para ofrecer la conversión
  // cuando el servicio no tiene tarifa en la moneda elegida (igual que el salario en
  // Personal). Son un puñado de pares: viajan con la página, no por ida y vuelta.
  const monedas = (monRes.data ?? []).map((m: { codigo: string }) => m.codigo)
  const tasas = monedas.length > 1 ? await mapaTasas(db, session.client_id, monedas) : {}

  return {
    suscripciones,
    // Los terceros son POR EMPRESA (`third_parties.empresa_id` es NOT NULL): el mismo
    // negocio real puede tener una ficha en cada una. El selector las filtra por la
    // empresa elegida — si no, salen repetidos y se puede atar una suscripción de una
    // empresa a la ficha de otra.
    clientes: terceros
      .filter(t => t.activo && (t.tipo === 'CLIENTE' || t.tipo === 'AMBOS'))
      .map(t => ({ tercero_id: t.tercero_id, nombre: t.nombre, empresa_id: t.empresa_id })),
    servicios: productos
      .filter(p => p.es_suscribible && p.estado === 'ACTIVO')
      .map(p => ({
        producto_id:          p.producto_id,
        nombre:               p.nombre,
        precios:              (typeof p.precios === 'object' && p.precios !== null) ? p.precios : {},
        periodicidad_defecto: (p.periodicidad_defecto as PeriodicidadSub | null) ?? null,
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

  // Los servicios del acuerdo viajan como JSON: [{ producto_id, precio_mensual,
  // descuento_modo, descuento_valor }]. El descuento es de CADA servicio (mig. 125).
  let lineas: { producto_id: string; precio_mensual: number; descuento_modo: DescuentoModo; descuento_valor: number }[] = []
  try {
    const raw = JSON.parse(g('lineas') || '[]')
    if (Array.isArray(raw)) {
      lineas = raw
        .map((l: Record<string, unknown>) => ({
          producto_id:     String(l?.producto_id ?? '').trim(),
          precio_mensual:  Number(l?.precio_mensual) || 0,
          descuento_modo:  (l?.descuento_modo === 'MONTO_FIJO' ? 'MONTO_FIJO' : 'PORCENTAJE') as DescuentoModo,
          descuento_valor: Number(l?.descuento_valor) || 0,
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
  const { data: mon } = await db.from('monedas')
    .select('codigo').eq('client_id', session.client_id).eq('codigo', moneda).eq('activa', true).maybeSingle()
  if (!mon) return { ok: false, error: 'Elige una moneda activa del negocio.' }

  // Todos los servicios deben ser SERVICIOS suscribibles del cliente. Se comprueban
  // los del formulario contra la base de una vez: la lista del navegador no es
  // control de acceso, y aquí se cuelan `producto_id` por POST igual que uno solo.
  const { data: srvs } = await db.from('products')
    .select('producto_id').eq('client_id', session.client_id)
    .eq('tipo', 'SERVICIO').eq('es_suscribible', true)
    .in('producto_id', [...new Set(lineas.map(l => l.producto_id))])
  const validos = new Set(((srvs ?? []) as { producto_id: string }[]).map(p => p.producto_id))
  if (lineas.some(l => !validos.has(l.producto_id)))
    return { ok: false, error: 'Algún servicio elegido no es suscribible.' }

  // El cliente tiene que ser de ESA empresa. Los terceros son por empresa, así que sin
  // esta guardia se podía atar una suscripción de la Empresa 1 a la ficha de la Empresa 3
  // y la factura —que sí pertenece a una empresa— saldría a nombre de un tercero ajeno.
  const { data: ter } = await db.from('third_parties')
    .select('tercero_id').eq('client_id', session.client_id)
    .eq('tercero_id', cliente_id).eq('empresa_id', empresa_id).maybeSingle()
  if (!ter) return { ok: false, error: 'Ese cliente no es de la empresa elegida.' }

  const campos = {
    empresa_id, cliente_id, moneda, periodicidad,
    fecha_inicio, fecha_proximo_cobro,
    fecha_fin, renovacion_automatica, notas,
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
    const suscripcion_id = generarSuscripcionId()
    const { error } = await db.from('suscripciones').insert({
      suscripcion_id,
      client_id: session.client_id,
      estado:    'ACTIVA',
      created_at: new Date().toISOString(),
      ...campos,
    })
    if (error) { console.error('[suscripciones] insert:', error); return { ok: false, error: `Error al crear: ${error.message}` } }

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
      factura = await borradorDelPrimerCobro(
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

export async function cambiarEstadoSuscripcion(
  suscripcion_id: string, estado: EstadoSub,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('servicios')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!['ACTIVA', 'PAUSADA', 'CANCELADA'].includes(estado))
    return { ok: false, error: 'Estado inválido.' }

  const db = createAdminClient()
  const { error } = await db.from('suscripciones')
    .update({ estado, updated_at: new Date().toISOString() })
    .eq('suscripcion_id', suscripcion_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo cambiar el estado.' }
  revalidatePath('/portal/suscripciones')
  return { ok: true }
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
    .select('periodicidad, fecha_fin')
    .eq('suscripcion_id', suscripcion_id).eq('client_id', session.client_id).maybeSingle()
  if (!s) return { ok: false, error: 'Suscripción no encontrada.' }

  // Reactivar; si tenía fin, se empuja un período desde el mayor de (fin, hoy).
  const per  = s.periodicidad as PeriodicidadSub
  const base = s.fecha_fin && (s.fecha_fin as string) > hoyStr() ? (s.fecha_fin as string) : hoyStr()
  const nuevaFin = s.fecha_fin ? sumarPeriodo(base, per) : null

  const { error } = await db.from('suscripciones')
    .update({ estado: 'ACTIVA', fecha_fin: nuevaFin, updated_at: new Date().toISOString() })
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
