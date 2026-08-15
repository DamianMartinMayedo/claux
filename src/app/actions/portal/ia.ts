'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { tieneModulo }       from '@/lib/modulos'
import { configAgente }      from '@/lib/ia/contexto'
import { generarInsight, responderChat, type TipoInsight, type TurnoChat } from '@/lib/ia/agente'
import { sugerirDatosItem, type SugerenciaItem } from '@/lib/ia/catalogo'
import { sugerirDatosProducto, type SugerenciaProducto } from '@/lib/ia/producto'
import { interpretarConteoDictado, emparejarConteo } from '@/lib/ia/conteo'
import {
  revisarNomina, explicarRecibo,
  type LineaRevision, type EntradaRecibo,
} from '@/lib/ia/nomina'
// El MISMO cargador que dibuja el recibo en PDF: es lo que garantiza que la explicación
// de la IA y el papel digan las mismas cifras.
import { obtenerReciboNomina } from './rrhh'
import { sugerirSeccionDossier, sugerirResumenPortada, revisarDossier, traducirDossier } from '@/lib/ia/dossier'
import { SECCIONES_RELATO } from '@/lib/dossier/secciones'
import { estadoDeResultados } from '@/lib/dossier/estado'
import type { FilaSerie } from '@/lib/dossier/snapshot'
import type { LineaDesglose } from '@/lib/dossier/base'
import { obtenerUsoMes, type UsoMes } from '@/lib/ia/uso'
import { IaNoConfigurada }   from '@/lib/ia/provider'
import { etiquetasDe, ETIQUETAS_DEFAULT } from '@/lib/sector'

// ── Tipos para historial ──
export interface ConversacionResumen {
  conversacion_id: string
  titulo: string
  created_at: string
  updated_at: string
  ultimo_mensaje?: string
}

export interface ConversacionCompleta {
  conversacion_id: string
  titulo: string
  mensajes: TurnoChat[]
}

// El addon de IA NO es un módulo del sidebar: se gatea en cada punto con
// tieneModulo('asistente_ia'). Helper común para todas las actions.
async function requireAddonIa(): Promise<{ clientId: string; nombreUsuario: string | null } | { error: string }> {
  const session = await getPortalSession()
  if (!session) return { error: 'Sin sesión.' }
  const db = createAdminClient()
  const [{ data: cliente }, { data: usuario }] = await Promise.all([
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).single(),
    db.from('client_users').select('nombre').eq('user_id', session.user_id).maybeSingle(),
  ])
  if (!tieneModulo(cliente?.modulos_activos, 'asistente_ia')) return { error: 'El asistente IA no está contratado.' }
  return { clientId: session.client_id, nombreUsuario: (usuario?.nombre as string | null) ?? null }
}

function mensajeError(e: unknown): string {
  if (e instanceof IaNoConfigurada) return 'El asistente aún no está configurado. Inténtalo más tarde.'
  return 'No pude generar la respuesta ahora mismo. Inténtalo de nuevo en un momento.'
}

export type IaRespuesta = { ok: true; texto: string } | { ok: false; error: string }

// ── Insights puntuales (touchpoints) ──
export async function generarInsightIa(tipo: TipoInsight): Promise<IaRespuesta> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }
  try {
    const texto = await generarInsight(guard.clientId, tipo, guard.nombreUsuario)
    return { ok: true, texto }
  } catch (e) {
    console.error('[ia] generarInsight', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Chat libre del dueño (botón flotante) ──
export async function chatAgenteIa(historial: TurnoChat[], mensaje: string): Promise<IaRespuesta> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }
  const texto0 = (mensaje ?? '').trim()
  if (!texto0) return { ok: false, error: 'Escribe un mensaje.' }
  try {
    const hist = Array.isArray(historial) ? historial.slice(-8) : []
    const texto = await responderChat(guard.clientId, hist, texto0, guard.nombreUsuario)
    return { ok: true, texto }
  } catch (e) {
    console.error('[ia] chatAgente', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Nómina: revisar el borrador y explicar el recibo (IA de cara al dueño) ──
//
// Las dos son tareas sobre datos CONCRETOS, no «insights» de sección: por eso van como
// acción propia con sus datos, igual que el autocompletado del catálogo o el conteo
// dictado. La IA **solo propone** y **no puede confirmar una nómina** — confirmar es lo
// único irreversible del módulo y sigue siendo un clic del dueño.
//
// LECTURA: el candado del módulo lo pone la página de Nómina (`requireModulo('rrhh')`);
// aquí solo se comprueba el addon de IA.

export type IaTextoOpcional = { ok: true; texto: string } | { ok: false; error: string }

/** R8.1 · Repasa un borrador y señala lo que se sale de lo normal, antes de confirmar. */
export async function revisarNominaIa(nomina_id: string): Promise<IaTextoOpcional> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()
  const { data: nomina } = await db.from('nominas')
    .select('nomina_id, empresa_id, periodo, moneda, estado')
    .eq('nomina_id', nomina_id).eq('client_id', guard.clientId).maybeSingle()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }

  const { data: lineas } = await db.from('nomina_lineas')
    .select('empleado_id, empleado_nombre, cargo, devengado, deducciones')
    .eq('nomina_id', nomina_id).eq('client_id', guard.clientId).order('empleado_nombre')
  const filas = (lineas ?? []) as {
    empleado_id: string; empleado_nombre: string; cargo: string | null
    devengado: number; deducciones: number
  }[]
  if (!filas.length) return { ok: false, error: 'Esa nómina no tiene líneas.' }

  const empIds = filas.map(f => f.empleado_id)

  // El histórico: los 6 períodos anteriores de la MISMA empresa y moneda, que es contra
  // lo que tiene sentido comparar. Sin esto la IA no puede decir «cobra más de lo suyo».
  const { data: previas } = await db.from('nominas')
    .select('nomina_id, periodo')
    .eq('client_id', guard.clientId).eq('empresa_id', nomina.empresa_id)
    .eq('moneda', nomina.moneda).eq('estado', 'CONFIRMADA')
    .lt('periodo', nomina.periodo)
    .order('periodo', { ascending: false }).limit(6)
  const idsPrevias = ((previas ?? []) as { nomina_id: string; periodo: string }[])

  const histPorEmpleado = new Map<string, number[]>()
  if (idsPrevias.length) {
    const { data: hist } = await db.from('nomina_lineas')
      .select('nomina_id, empleado_id, devengado')
      .eq('client_id', guard.clientId)
      .in('nomina_id', idsPrevias.map(n => n.nomina_id))
      .in('empleado_id', empIds)
    const ordenDe = new Map(idsPrevias.map((n, i) => [n.nomina_id, i]))
    const bruto = new Map<string, { orden: number; monto: number }[]>()
    for (const l of (hist ?? []) as { nomina_id: string; empleado_id: string; devengado: number }[]) {
      const arr = bruto.get(l.empleado_id) ?? []
      arr.push({ orden: ordenDe.get(l.nomina_id) ?? 99, monto: Number(l.devengado) })
      bruto.set(l.empleado_id, arr)
    }
    for (const [id, arr] of bruto) {
      histPorEmpleado.set(id, arr.sort((a, b) => a.orden - b.orden).map(x => x.monto))
    }
  }

  // Alta o baja DENTRO del período: es el caso que cobra el mes completo sin haberlo
  // trabajado entero, y el que más dinero mueve de todos los que la IA puede señalar.
  const [yy, mm] = nomina.periodo.split('-').map(Number)
  const inicio = `${nomina.periodo}-01`
  const fin    = `${nomina.periodo}-${String(new Date(yy, mm, 0).getDate()).padStart(2, '0')}`
  const { data: fichas } = await db.from('empleados')
    .select('empleado_id, fecha_alta, fecha_baja')
    .eq('client_id', guard.clientId).in('empleado_id', empIds)
  const fichaDe = new Map(((fichas ?? []) as {
    empleado_id: string; fecha_alta: string | null; fecha_baja: string | null
  }[]).map(f => [f.empleado_id, f]))

  // Los días cargados del mes y el modelo de la empresa: bajo MIPYME_CUBA unas
  // retenciones a cero SÍ son raras, y en el General no significan nada.
  const [{ data: incs }, { data: cfg }] = await Promise.all([
    db.from('incidencias_nomina').select('empleado_id, dias_trabajados')
      .eq('client_id', guard.clientId).eq('periodo', nomina.periodo).in('empleado_id', empIds),
    db.from('empresa_config_nomina').select('modelo')
      .eq('client_id', guard.clientId).eq('empresa_id', nomina.empresa_id).maybeSingle(),
  ])
  const diasDe = new Map(((incs ?? []) as { empleado_id: string; dias_trabajados: number | null }[])
    .map(i => [i.empleado_id, i.dias_trabajados === null ? null : Number(i.dias_trabajados)]))
  const modelo = (cfg?.modelo as string) ?? 'GENERAL'

  const filasIa: LineaRevision[] = filas.map(f => {
    const ficha = fichaDe.get(f.empleado_id)
    const alta = ficha?.fecha_alta?.slice(0, 10)
    const baja = ficha?.fecha_baja?.slice(0, 10)
    return {
      nombre:      f.empleado_nombre,
      cargo:       f.cargo,
      devengado:   Number(f.devengado),
      retenciones: Number(f.deducciones),
      dias:        diasDe.get(f.empleado_id) ?? null,
      historico:   histPorEmpleado.get(f.empleado_id) ?? [],
      alta_en_periodo: !!alta && alta >= inicio && alta <= fin,
      baja_en_periodo: !!baja && baja >= inicio && baja <= fin,
    }
  })

  const texto = await revisarNomina(guard.clientId, {
    periodo: nomina.periodo, moneda: nomina.moneda, modelo, lineas: filasIa,
  })
  if (!texto) return { ok: false, error: 'No pude revisar la nómina ahora mismo. Inténtalo de nuevo.' }
  return { ok: true, texto }
}

/** R8.2 · Explica un recibo en lenguaje llano, para leérselo al trabajador. */
export async function explicarReciboIa(
  nomina_id: string, empleado_id: string,
): Promise<IaTextoOpcional> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  // Se reusa el MISMO cargador que dibuja el recibo en PDF: es lo que garantiza que la
  // explicación y el papel digan las mismas cifras.
  const r = await obtenerReciboNomina(nomina_id, empleado_id)
  if (!r.ok) return { ok: false, error: r.error }
  const rec = r.recibo

  const db = createAdminClient()
  // Neto del mes anterior, para poder responder «¿por qué cobro menos que el mes pasado?»,
  // que es la pregunta real. Sin él la explicación se queda en describir el recibo.
  // La empresa sale de la nómina, no del recibo (que lleva sus datos fiscales, no su id).
  const { data: estaNomina } = await db.from('nominas').select('empresa_id')
    .eq('nomina_id', nomina_id).eq('client_id', guard.clientId).maybeSingle()
  const { data: previa } = await db.from('nominas')
    .select('nomina_id')
    .eq('client_id', guard.clientId).eq('empresa_id', estaNomina?.empresa_id ?? '__none__')
    .eq('estado', 'CONFIRMADA').lt('periodo', rec.periodo)
    .order('periodo', { ascending: false }).limit(1).maybeSingle()
  let neto_anterior: number | null = null
  if (previa?.nomina_id) {
    const { data: ln } = await db.from('nomina_lineas').select('neto')
      .eq('client_id', guard.clientId).eq('nomina_id', previa.nomina_id)
      .eq('empleado_id', empleado_id).maybeSingle()
    if (ln) neto_anterior = Number(ln.neto)
  }

  const entrada: EntradaRecibo = {
    trabajador:   rec.trabajador.nombre,
    periodo:      rec.periodo,
    moneda:       rec.moneda,
    salario_base: rec.salario_base,
    devengado:    rec.devengado,
    neto:         rec.neto,
    // Solo lo que afecta a SU neto: los `aportes` son coste de la EMPRESA por encima del
    // bruto, y meterlos aquí haría creer al trabajador que le descuentan algo que no le
    // descuentan. Es la misma separación que hace el recibo en papel.
    conceptos: [
      ...rec.devengos.map(c    => ({ nombre: c.nombre, tipo: 'DEVENGO',   monto: c.monto })),
      ...rec.retenciones.map(c => ({ nombre: c.nombre, tipo: 'RETENCION', monto: c.monto })),
    ],
    neto_anterior,
    dias: rec.dias_trabajados,
  }

  const texto = await explicarRecibo(guard.clientId, entrada)
  if (!texto) return { ok: false, error: 'No pude preparar la explicación ahora mismo. Inténtalo de nuevo.' }
  return { ok: true, texto }
}

// ── Autocompletar ficha de un ítem del Catálogo (IA de cara al dueño) ──
export type IaSugerenciaItem = { ok: true; sugerencia: SugerenciaItem } | { ok: false; error: string }

export async function autocompletarItemCatalogo(nombre: string): Promise<IaSugerenciaItem> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }
  const nombre0 = (nombre ?? '').trim()
  if (!nombre0) return { ok: false, error: 'Escribe primero el nombre del producto.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('sector').eq('client_id', guard.clientId).single()
  const sector = (cli?.sector as string | null) ?? null

  let etiquetas = ETIQUETAS_DEFAULT
  if (sector) {
    const { data: pl } = await db.from('plantillas_sector').select('etiquetas').eq('sector', sector).maybeSingle()
    etiquetas = etiquetasDe(pl?.etiquetas)
  }
  // Solo un negocio de comida tiene ingredientes/alérgenos/calorías: fuera de ahí
  // la IA no debe inventarlos (una ferretería no tiene alérgenos).
  const esComida = etiquetas.catalogoIcono === 'comida'

  try {
    const sugerencia = await sugerirDatosItem(guard.clientId, nombre0, etiquetas.catalogo, sector, esComida)
    if (!sugerencia) return { ok: false, error: 'No pude generar sugerencias ahora mismo. Inténtalo de nuevo.' }
    return { ok: true, sugerencia }
  } catch (e) {
    console.error('[ia] autocompletarItemCatalogo', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Autocompletar la ficha de un producto/servicio (IA de cara al dueño) ──
//
// Antes solo sugería la DESCRIPCIÓN; ahora también unidad y categoría, que es el
// grueso del alta. Las dos listas cerradas se las pasa el CÓDIGO (las unidades del
// selector y las categorías activas de ESTE cliente) y se verifican al volver: la IA
// no inventa unidades ni crea categorías.
export type IaFichaProducto =
  | { ok: true; sugerencia: SugerenciaProducto }
  | { ok: false; error: string }

export async function autocompletarFichaProducto(
  nombre: string,
  esServicio: boolean,
  unidades: string[],
): Promise<IaFichaProducto> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }
  const nombre0 = (nombre ?? '').trim()
  if (!nombre0) return { ok: false, error: 'Escribe primero el nombre.' }

  const db = createAdminClient()
  const tipo = esServicio ? 'SERVICIO' : 'PRODUCTO'
  const [{ data: cli }, { data: cats }] = await Promise.all([
    db.from('clients').select('sector').eq('client_id', guard.clientId).single(),
    // Las de SU tipo (o AMBAS) y solo activas: mig. 122.
    db.from('product_categories').select('categoria_id, nombre')
      .eq('client_id', guard.clientId).eq('estado', 'ACTIVO')
      .in('tipo', [tipo, 'AMBAS']).order('nombre'),
  ])

  try {
    const sugerencia = await sugerirDatosProducto(
      guard.clientId, nombre0, esServicio, (cli?.sector as string | null) ?? null,
      Array.isArray(unidades) ? unidades : [],
      ((cats ?? []) as { categoria_id: string; nombre: string }[]),
    )
    if (!sugerencia) return { ok: false, error: 'No pude generar sugerencias ahora mismo. Inténtalo de nuevo.' }
    return { ok: true, sugerencia }
  } catch (e) {
    console.error('[ia] autocompletarFichaProducto', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Interpretar un conteo dictado (IA de cara al dueño) ──
//
// «Quedan doce cajas de agua y tres de cerveza» → líneas del conteo precargadas.
// NADA se aplica: se devuelven las cantidades reconocidas para que la pantalla las
// ponga en la columna «contado» de un BORRADOR y el dueño revise y aplique.
//
// El modelo devuelve texto + cantidad; el EMPAREJAMIENTO con el catálogo lo hace el
// código (`lib/ia/conteo.ts`). Lo que no empareja se devuelve aparte, nunca se
// descarta en silencio.
export type IaConteoDictado =
  | { ok: true; reconocidos: { producto_id: string; nombre: string; cantidad: number; texto: string }[]
      noReconocidos: { texto: string; cantidad: number }[] }
  | { ok: false; error: string }

export async function interpretarConteo(conteo_id: string, dictado: string): Promise<IaConteoDictado> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }
  const texto = (dictado ?? '').trim()
  if (!texto) return { ok: false, error: 'Dicta o escribe lo que has contado.' }

  const db = createAdminClient()
  // El catálogo con el que se empareja es el del CONTEO: los productos que ya están
  // en su hoja. Emparejar contra el catálogo entero metería en el conteo productos de
  // otro almacén.
  const { data: conteo } = await db.from('conteos').select('conteo_id, estado')
    .eq('conteo_id', conteo_id).eq('client_id', guard.clientId).maybeSingle()
  if (!conteo) return { ok: false, error: 'Conteo no encontrado.' }
  if (conteo.estado !== 'BORRADOR') return { ok: false, error: 'Este conteo ya se aplicó: es solo lectura.' }

  const { data: lineas } = await db.from('conteo_lineas').select('producto_id')
    .eq('conteo_id', conteo_id).eq('client_id', guard.clientId)
  const ids = ((lineas ?? []) as { producto_id: string }[]).map(l => l.producto_id)
  if (ids.length === 0) return { ok: false, error: 'Este conteo no tiene líneas todavía.' }

  const { data: prods } = await db.from('products').select('producto_id, nombre, codigo')
    .eq('client_id', guard.clientId).in('producto_id', ids)

  try {
    const items = await interpretarConteoDictado(guard.clientId, texto)
    if (!items) return { ok: false, error: 'No pude interpretar lo que has dictado. Inténtalo de nuevo.' }
    const { reconocidos, noReconocidos } = emparejarConteo(
      items, (prods ?? []) as { producto_id: string; nombre: string; codigo: string }[],
    )
    return { ok: true, reconocidos, noReconocidos }
  } catch (e) {
    console.error('[ia] interpretarConteo', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Redactar una sección del relato del Dossier (IA de cara al dueño) ──
// Vive aquí y no en dossier.ts porque `requireAddonIa` es privado: en un fichero
// 'use server' todo export es una server action pública, así que el gate no puede
// exportarse. Meter la action donde vive el gate lo mantiene en UN sitio (la
// alternativa era duplicar el tieneModulo(…,'asistente_ia'), como citas/reservas).
export type IaSugerenciaSeccion = { ok: true; cuerpo: string } | { ok: false; error: string }

export async function redactarSeccionDossier(clave: string, borrador?: string): Promise<IaSugerenciaSeccion> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const espec = SECCIONES_RELATO.find(s => s.clave === clave)
  if (!espec) return { ok: false, error: 'Sección desconocida.' }

  const db = createAdminClient()
  const [{ data: cli }, { data: dos }] = await Promise.all([
    db.from('clients').select('sector, nombre_empresa').eq('client_id', guard.clientId).single(),
    db.from('dossiers').select('dossier_id, moneda_presentacion')
      .eq('client_id', guard.clientId).order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ])
  if (!dos) return { ok: false, error: 'Crea primero tu dossier.' }

  const [{ data: serieRows }, { data: lineaRows }, { data: seccionRows }] = await Promise.all([
    db.from('dossier_serie').select('mes, ingresos, costo_ventas, gastos_operativos, moneda, origen')
      .eq('dossier_id', dos.dossier_id).eq('client_id', guard.clientId).order('mes'),
    db.from('dossier_lineas').select('grupo, concepto, monto, orden')
      .eq('dossier_id', dos.dossier_id).eq('client_id', guard.clientId).order('orden'),
    db.from('dossier_secciones').select('clave, cuerpo')
      .eq('dossier_id', dos.dossier_id).eq('client_id', guard.clientId).order('orden'),
  ])

  const serie: FilaSerie[] = (serieRows ?? []).map((r: Record<string, unknown>) => ({
    mes: r.mes as string,
    ingresos: Number(r.ingresos), costo_ventas: Number(r.costo_ventas), gastos_operativos: Number(r.gastos_operativos),
    moneda: r.moneda as string, origen: (r.origen === 'BASE' ? 'BASE' : 'MANUAL'),
  }))
  const lineas: LineaDesglose[] = (lineaRows ?? []).map((r: Record<string, unknown>) => ({
    grupo: r.grupo as LineaDesglose['grupo'], concepto: r.concepto as string, monto: Number(r.monto), orden: Number(r.orden),
  }))

  // El CÓDIGO calcula las cifras; la IA solo las redacta. Ver la regla dura en lib/ia/dossier.ts.
  const er = estadoDeResultados(serie, lineas)
  const cifras = serie.length > 0
    ? { ingresos: er.ingresos, margenBrutoPct: er.margenBrutoPct, resultadoNeto: er.resultadoNeto, meses: serie.length }
    : null

  const otras = (seccionRows ?? [])
    .map((r: Record<string, unknown>) => ({ clave: r.clave as string, cuerpo: ((r.cuerpo as string) ?? '').trim() }))
    .filter(s => s.clave !== clave && s.cuerpo.length > 0)
    .map(s => ({ etiqueta: SECCIONES_RELATO.find(e => e.clave === s.clave)?.etiqueta ?? s.clave, cuerpo: s.cuerpo }))

  try {
    const sug = await sugerirSeccionDossier(guard.clientId, espec, {
      negocio: (cli?.nombre_empresa as string) || 'Mi negocio',
      sector: (cli?.sector as string | null) ?? null,
      moneda: dos.moneda_presentacion as string,
      cifras,
      otras,
      borrador: (borrador ?? '').slice(0, 1200),
    })
    if (!sug?.cuerpo) return { ok: false, error: 'No pude generar un borrador ahora mismo. Inténtalo de nuevo.' }
    return { ok: true, cuerpo: sug.cuerpo }
  } catch (e) {
    console.error('[ia] redactarSeccionDossier', e)
    return { ok: false, error: mensajeError(e) }
  }
}

export type IaResumenPortada = { ok: true; linea: string } | { ok: false; error: string }

// IA3: redacta la línea de pitch de la portada. Mismo patrón y regla dura que
// redactarSeccionDossier (la IA no calcula cifras). Recibe el dossierId del editor
// para acertar el dossier; sin él, cae al más antiguo (como el resto de la IA).
export async function redactarResumenPortada(dossierId?: string, borrador?: string): Promise<IaResumenPortada> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()
  const dosQuery = db.from('dossiers').select('dossier_id, moneda_presentacion').eq('client_id', guard.clientId)
  const [{ data: cli }, { data: dos }] = await Promise.all([
    db.from('clients').select('sector, nombre_empresa').eq('client_id', guard.clientId).single(),
    (dossierId
      ? dosQuery.eq('dossier_id', dossierId)
      : dosQuery.order('created_at', { ascending: true }).limit(1)
    ).maybeSingle(),
  ])
  if (!dos) return { ok: false, error: 'Crea primero tu dossier.' }

  const [{ data: serieRows }, { data: lineaRows }, { data: seccionRows }] = await Promise.all([
    db.from('dossier_serie').select('mes, ingresos, costo_ventas, gastos_operativos, moneda, origen')
      .eq('dossier_id', dos.dossier_id).eq('client_id', guard.clientId).order('mes'),
    db.from('dossier_lineas').select('grupo, concepto, monto, orden')
      .eq('dossier_id', dos.dossier_id).eq('client_id', guard.clientId).order('orden'),
    db.from('dossier_secciones').select('clave, cuerpo')
      .eq('dossier_id', dos.dossier_id).eq('client_id', guard.clientId).order('orden'),
  ])

  const serie: FilaSerie[] = (serieRows ?? []).map((r: Record<string, unknown>) => ({
    mes: r.mes as string,
    ingresos: Number(r.ingresos), costo_ventas: Number(r.costo_ventas), gastos_operativos: Number(r.gastos_operativos),
    moneda: r.moneda as string, origen: (r.origen === 'BASE' ? 'BASE' : 'MANUAL'),
  }))
  const lineas: LineaDesglose[] = (lineaRows ?? []).map((r: Record<string, unknown>) => ({
    grupo: r.grupo as LineaDesglose['grupo'], concepto: r.concepto as string, monto: Number(r.monto), orden: Number(r.orden),
  }))

  const er = estadoDeResultados(serie, lineas)
  const cifras = serie.length > 0
    ? { ingresos: er.ingresos, margenBrutoPct: er.margenBrutoPct, resultadoNeto: er.resultadoNeto, meses: serie.length }
    : null

  const otras = (seccionRows ?? [])
    .map((r: Record<string, unknown>) => ({ clave: r.clave as string, cuerpo: ((r.cuerpo as string) ?? '').trim() }))
    .filter(s => s.cuerpo.length > 0)
    .map(s => ({ etiqueta: SECCIONES_RELATO.find(e => e.clave === s.clave)?.etiqueta ?? s.clave, cuerpo: s.cuerpo }))

  try {
    const sug = await sugerirResumenPortada(guard.clientId, {
      negocio: (cli?.nombre_empresa as string) || 'Mi negocio',
      sector: (cli?.sector as string | null) ?? null,
      moneda: dos.moneda_presentacion as string,
      cifras,
      otras,
      borrador: (borrador ?? '').slice(0, 300),
    })
    if (!sug?.linea) return { ok: false, error: 'No pude generar un resumen ahora mismo. Inténtalo de nuevo.' }
    return { ok: true, linea: sug.linea }
  } catch (e) {
    console.error('[ia] redactarResumenPortada', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// Carga común del contexto de un dossier para las ayudas de IA que miran el dossier
// entero (revisión, relato completo). Sin dossierId, cae al más antiguo (como el
// resto de la IA). Filtra por client_id: un dossier de otro tenant no llega.
async function datosDossierIa(db: ReturnType<typeof createAdminClient>, clientId: string, dossierId?: string) {
  const dosQuery = db.from('dossiers')
    .select('dossier_id, moneda_presentacion, crecimiento_mensual_pct, resumen_portada').eq('client_id', clientId)
  const { data: dos } = await (dossierId
    ? dosQuery.eq('dossier_id', dossierId)
    : dosQuery.order('created_at', { ascending: true }).limit(1)
  ).maybeSingle()
  if (!dos) return null

  const [{ data: cli }, { data: serieRows }, { data: lineaRows }, { data: seccionRows }] = await Promise.all([
    db.from('clients').select('sector, nombre_empresa').eq('client_id', clientId).single(),
    db.from('dossier_serie').select('mes, ingresos, costo_ventas, gastos_operativos, moneda, origen')
      .eq('dossier_id', dos.dossier_id).eq('client_id', clientId).order('mes'),
    db.from('dossier_lineas').select('grupo, concepto, monto, orden')
      .eq('dossier_id', dos.dossier_id).eq('client_id', clientId).order('orden'),
    db.from('dossier_secciones').select('clave, cuerpo')
      .eq('dossier_id', dos.dossier_id).eq('client_id', clientId).order('orden'),
  ])

  const serie: FilaSerie[] = (serieRows ?? []).map((r: Record<string, unknown>) => ({
    mes: r.mes as string,
    ingresos: Number(r.ingresos), costo_ventas: Number(r.costo_ventas), gastos_operativos: Number(r.gastos_operativos),
    moneda: r.moneda as string, origen: (r.origen === 'BASE' ? 'BASE' : 'MANUAL'),
  }))
  const lineas: LineaDesglose[] = (lineaRows ?? []).map((r: Record<string, unknown>) => ({
    grupo: r.grupo as LineaDesglose['grupo'], concepto: r.concepto as string, monto: Number(r.monto), orden: Number(r.orden),
  }))
  const secciones = (seccionRows ?? []).map((r: Record<string, unknown>) => ({
    clave: r.clave as string, cuerpo: ((r.cuerpo as string) ?? '').trim(),
  }))

  return { dos, cli, serie, lineas, secciones }
}

export type IaRevisionDossier = { ok: true; observaciones: string[] } | { ok: false; error: string }

// IA1: revisión de coherencia del dossier entero. La IA lee y comenta, no calcula.
export async function revisarDossierIa(dossierId?: string): Promise<IaRevisionDossier> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()
  const datos = await datosDossierIa(db, guard.clientId, dossierId)
  if (!datos) return { ok: false, error: 'Crea primero tu dossier.' }

  const er = estadoDeResultados(datos.serie, datos.lineas)
  const cifras = datos.serie.length > 0
    ? { ingresos: er.ingresos, margenBrutoPct: er.margenBrutoPct, resultadoNeto: er.resultadoNeto, meses: datos.serie.length }
    : null
  const secciones = datos.secciones
    .filter(s => s.cuerpo.length > 0)
    .map(s => ({ etiqueta: SECCIONES_RELATO.find(e => e.clave === s.clave)?.etiqueta ?? s.clave, cuerpo: s.cuerpo }))

  try {
    const rev = await revisarDossier(guard.clientId, {
      negocio: (datos.cli?.nombre_empresa as string) || 'Mi negocio',
      sector: (datos.cli?.sector as string | null) ?? null,
      moneda: datos.dos.moneda_presentacion as string,
      cifras,
      crecimientoPct: Number(datos.dos.crecimiento_mensual_pct) || 0,
      secciones,
    })
    if (!rev || rev.observaciones.length === 0) return { ok: false, error: 'No pude revisarlo ahora mismo. Inténtalo de nuevo.' }
    return { ok: true, observaciones: rev.observaciones }
  } catch (e) {
    console.error('[ia] revisarDossierIa', e)
    return { ok: false, error: mensajeError(e) }
  }
}

export type IaTraduccionDossier =
  | { ok: true; resumenEn: string | null; secciones: { clave: string; cuerpoEn: string }[]; conceptos: { es: string; en: string }[] }
  | { ok: false; error: string }

// Fase 10: traduce el relato + resumen al inglés (para el botón ES/EN del deck). La
// IA solo TRADUCE; el guardado va aparte, por `guardarTraduccionIngles` (con su
// candado de módulo). Aquí no se escribe en BD.
export async function traducirDossierIa(dossierId?: string): Promise<IaTraduccionDossier> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()
  const datos = await datosDossierIa(db, guard.clientId, dossierId)
  if (!datos) return { ok: false, error: 'Crea primero tu dossier.' }

  const conCuerpo = datos.secciones
    .filter(s => s.cuerpo.length > 0)
    .map(s => ({ clave: s.clave, cuerpo: s.cuerpo }))
  const resumen = (datos.dos.resumen_portada as string | null)?.trim() || null
  // Conceptos del desglose que pinta «El detalle»: los grupos de GASTO (el de ingresos
  // ya no se muestra ahí). Distintos y en orden estable — se emparejan por posición.
  const conceptos = [...new Set(
    datos.lineas.filter(l => l.grupo !== 'INGRESO').map(l => l.concepto.trim()).filter(Boolean),
  )]
  if (conCuerpo.length === 0 && !resumen && conceptos.length === 0) {
    return { ok: false, error: 'No hay relato ni resumen que traducir todavía.' }
  }

  try {
    const trad = await traducirDossier(guard.clientId, { resumen, secciones: conCuerpo, conceptos })
    if (!trad) return { ok: false, error: 'No pude traducir ahora mismo. Inténtalo de nuevo.' }
    return {
      ok: true,
      resumenEn: trad.resumen,
      secciones: trad.secciones.filter(s => s.cuerpo.length > 0).map(s => ({ clave: s.clave, cuerpoEn: s.cuerpo })),
      conceptos: trad.conceptos,
    }
  } catch (e) {
    console.error('[ia] traducirDossierIa', e)
    return { ok: false, error: mensajeError(e) }
  }
}

export type IaRelatoCompleto = { ok: true; secciones: Record<string, string> } | { ok: false; error: string }

// IA2: primer borrador de TODO el relato. Genera solo las secciones VACÍAS (no pisa
// lo escrito); «equipo» se salta (tiene su propio «Traer mi plantilla»). Devuelve el
// mapa clave→cuerpo; el editor lo funde en las secciones que sigan vacías en pantalla.
export async function redactarRelatoCompleto(dossierId?: string): Promise<IaRelatoCompleto> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()
  const datos = await datosDossierIa(db, guard.clientId, dossierId)
  if (!datos) return { ok: false, error: 'Crea primero tu dossier.' }

  const er = estadoDeResultados(datos.serie, datos.lineas)
  const cifras = datos.serie.length > 0
    ? { ingresos: er.ingresos, margenBrutoPct: er.margenBrutoPct, resultadoNeto: er.resultadoNeto, meses: datos.serie.length }
    : null

  const conContenido = new Set(datos.secciones.filter(s => s.cuerpo.length > 0).map(s => s.clave))
  // Secciones a generar: las vacías y que no sean «equipo». Se generan en orden.
  const pendientes = SECCIONES_RELATO.filter(s => s.clave !== 'equipo' && !conContenido.has(s.clave))
  if (pendientes.length === 0) return { ok: false, error: 'Ya tienes escritas todas las secciones. Genera una suelta con «Ayúdame a escribir».' }

  const negocio = (datos.cli?.nombre_empresa as string) || 'Mi negocio'
  const sector = (datos.cli?.sector as string | null) ?? null
  const moneda = datos.dos.moneda_presentacion as string

  const salida: Record<string, string> = {}
  // Contexto «otras» acumulativo: cada sección generada alimenta la siguiente, para
  // que el borrador completo sea coherente consigo mismo y no se repita.
  const otras = datos.secciones
    .filter(s => s.cuerpo.length > 0)
    .map(s => ({ etiqueta: SECCIONES_RELATO.find(e => e.clave === s.clave)?.etiqueta ?? s.clave, cuerpo: s.cuerpo }))

  try {
    for (const espec of pendientes) {
      const sug = await sugerirSeccionDossier(guard.clientId, espec, { negocio, sector, moneda, cifras, otras })
      if (sug?.cuerpo) {
        salida[espec.clave] = sug.cuerpo
        otras.push({ etiqueta: espec.etiqueta, cuerpo: sug.cuerpo })
      }
    }
    if (Object.keys(salida).length === 0) return { ok: false, error: 'No pude generar el borrador ahora mismo. Inténtalo de nuevo.' }
    return { ok: true, secciones: salida }
  } catch (e) {
    console.error('[ia] redactarRelatoCompleto', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Consumo del cliente (sección informativa de Perfil) ──
// El nombre/tono del agente son globales (admin); el cliente solo VE su consumo.
export interface IaPanel { nombreAgente: string; uso: UsoMes }

export async function obtenerPanelIa(): Promise<IaPanel | null> {
  const guard = await requireAddonIa()
  if ('error' in guard) return null
  const [{ nombreAgente }, uso] = await Promise.all([configAgente(), obtenerUsoMes(guard.clientId)])
  return { nombreAgente, uso }
}

// ── Historial de conversaciones ──

// Guardar una conversación completa (nueva o existente)
export async function guardarConversacion(
  conversacionId: string | null,
  titulo: string,
  mensajes: TurnoChat[]
): Promise<{ ok: boolean; error?: string; conversacion_id?: string }> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()

  // Generar ID si es nueva
  const convId = conversacionId ?? `CONV-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`

  // Insertar o actualizar conversación
  const { error: convError } = await db.from('ia_conversaciones').upsert({
    conversacion_id: convId,
    client_id: guard.clientId,
    user_id: guard.clientId, // Usamos clientId como user_id del portal
    titulo: titulo || 'Nueva conversación',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'conversacion_id' })

  if (convError) return { ok: false, error: convError.message }

  // Borrar mensajes anteriores y insertar los nuevos
  await db.from('ia_mensajes').delete().eq('conversacion_id', convId)

  if (mensajes.length > 0) {
    const mensajesToInsert = mensajes.map(m => ({
      mensaje_id: `MSG-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`,
      conversacion_id: convId,
      rol: m.rol,
      contenido: m.texto,
    }))

    const { error: msgError } = await db.from('ia_mensajes').insert(mensajesToInsert)
    if (msgError) return { ok: false, error: msgError.message }
  }

  return { ok: true, conversacion_id: convId }
}

// Obtener lista de conversaciones del usuario
export async function obtenerConversaciones(): Promise<{ ok: boolean; error?: string; conversaciones?: ConversacionResumen[] }> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()

  const { data, error } = await db.from('ia_conversaciones')
    .select('conversacion_id, titulo, created_at, updated_at')
    .eq('client_id', guard.clientId)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) return { ok: false, error: error.message }

  const conversaciones: ConversacionResumen[] = (data ?? []).map(c => ({
    conversacion_id: c.conversacion_id,
    titulo: c.titulo,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }))

  return { ok: true, conversaciones }
}

// Obtener mensajes de una conversación específica
export async function obtenerMensajesConversacion(
  conversacionId: string
): Promise<{ ok: boolean; error?: string; conversacion?: ConversacionCompleta }> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()

  const { data: convData, error: convError } = await db.from('ia_conversaciones')
    .select('conversacion_id, titulo')
    .eq('conversacion_id', conversacionId)
    .eq('client_id', guard.clientId)
    .single()

  if (convError || !convData) return { ok: false, error: 'Conversación no encontrada' }

  const { data: msgData, error: msgError } = await db.from('ia_mensajes')
    .select('rol, contenido')
    .eq('conversacion_id', conversacionId)
    .order('created_at', { ascending: true })

  if (msgError) return { ok: false, error: msgError.message }

  const mensajes: TurnoChat[] = (msgData ?? []).map(m => ({
    rol: m.rol as 'user' | 'assistant',
    texto: m.contenido,
  }))

  return {
    ok: true,
    conversacion: {
      conversacion_id: convData.conversacion_id,
      titulo: convData.titulo,
      mensajes,
    }
  }
}

// Eliminar una conversación
export async function eliminarConversacion(
  conversacionId: string
): Promise<{ ok: boolean; error?: string }> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()

  const { error } = await db.from('ia_conversaciones')
    .delete()
    .eq('conversacion_id', conversacionId)
    .eq('client_id', guard.clientId)

  if (error) return { ok: false, error: error.message }

  return { ok: true }
}
