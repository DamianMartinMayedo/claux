'use server'

// Server actions del módulo Caja (portal del dueño). Gestión de instancias de
// caja (crear/config/token), lectura del detalle (operaciones + movimientos de
// stock + cierres) y subida de archivo para sincronizar sin conexión.
// El detalle vive en las tablas del módulo; los efectos en Tesorería/Inventario
// los aplica el núcleo compartido (@/lib/caja/ingesta), no estas acciones.

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { ingestarLote, contabilizarCierre, type LotePayload, type CajaRow } from '@/lib/caja/ingesta'
import { tieneModulo }      from '@/lib/modulos'
import { LIMITE_LISTADO, limiteDelFiltro, rangoUltimosMeses, type FiltroListado } from '@/lib/listados'
import { diaDelNegocio } from '@/lib/fecha-tz'

// ── Tipos ─────────────────────────────────────────────────────────────────────

/** Qué baja al dispositivo (mig. 120). Mismo vocabulario que `TipoImportacion` del catálogo QR.
 *  Sin `export`: un fichero `'use server'` solo puede exportar funciones async (un array
 *  es un objeto en runtime y rompe el build). Solo se usa aquí abajo. */
const TIPOS_CATALOGO = ['PRODUCTO', 'SERVICIO', 'AMBOS'] as const

export interface Caja {
  caja_id:           string
  client_id:         string
  empresa_id:        string
  nombre:            string
  almacen_id:        string | null
  cuentas_moneda:    Record<string, string>
  /** Moneda → cuenta donde entra lo cobrado por transferencia (mig. 172). Opcional. */
  cuentas_transferencia: Record<string, string>
  monedas_aceptadas: string[]
  tipos_catalogo:    string
  sync_token:        string
  activa:            boolean
  last_sync_at:      string | null
  created_at:        string
}

export interface Ticket {
  ticket_uuid: string
  caja_id:     string
  fecha:       string
  moneda:      string
  total:       number
  medio_pago:  string | null
  sesion_uuid: string | null
  estado:      string   // VIGENTE | ANULADO | RECTIFICACION
}

export interface MovimientoStock {
  ticket_uuid:     string
  fecha:           string
  caja_id:         string
  producto_id:     string | null
  descripcion:     string
  cantidad:        number
  precio_unitario: number
}

export interface Cierre {
  sesion_uuid:      string
  caja_id:          string
  abierta_at:       string
  cerrada_at:       string | null
  estado:           string
  total_por_moneda: Record<string, number>
  efectivo_contado: Record<string, number>
  posted_at:        string | null
  tesoreria_movs:   Record<string, string> | null
  stock_movs:       Record<string, string> | null
}

export interface CajaConfigData {
  caja:      Caja
  empresas:  { empresa_id: string; nombre: string }[]
  almacenes: { almacen_id: string; nombre: string; empresa_id: string }[]
  cuentas:   { cuenta_id: string; nombre: string; moneda: string; empresa_id: string }[]
  monedas:   string[]
  baseUrl:   string
  tieneBase:       boolean
  tieneInventario: boolean
  tieneServicios:  boolean
  /**
   * Cuántos servicios suscribibles hay con acuerdos vivos. Si además se cobran en el
   * mostrador, esa venta entra DOS veces en el estado de resultados: el cierre escribe su
   * COBRO (mig. 149) y la factura de la suscripción cuenta como Ventas.
   */
  suscribiblesActivos: number
  // ¿Hay cierres ya sincronizados? Solo sirve para que el aviso de cambio de
  // empresa no mienta: sin histórico no hay nada que se quede en la empresa vieja.
  tieneHistorico:  boolean
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function generarCajaId(): string {
  return `CAJ-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
function generarToken(): string {
  // 32 hex (128 bits): suficiente para un token revocable + rate-limitado, y
  // hace el enlace de instalación bastante más corto.
  return crypto.randomUUID().replace(/-/g, '')
}

async function empresaIds(): Promise<string[]> {
  const empresas = await obtenerEmpresas()
  return empresas.map(e => e.empresa_id)
}

/** Todo lo que toca contabilizar un cierre: su detalle y los dos módulos que recibe. Sin
 *  `export` (en un fichero `'use server'` solo se exportan funciones async). */
function revalidarCaja(caja_id?: string) {
  revalidatePath('/portal/caja')
  revalidatePath('/portal/caja/operaciones')
  revalidatePath('/portal/caja/cierres')
  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/inventario')
  if (caja_id) revalidatePath(`/portal/caja/${caja_id}`)
}

// ── Listar cajas (hub) ──────────────────────────────────────────────────────────

export async function listarCajas(): Promise<Caja[]> {
  const session = await getPortalSession()
  if (!session) return []
  const db  = createAdminClient()
  const ids = await empresaIds()
  const { data } = await db.from('cajas').select('*')
    .eq('client_id', session.client_id)
    .in('empresa_id', ids.length ? ids : ['__none__'])
    .order('created_at', { ascending: false })
  return (data ?? []) as Caja[]
}

/**
 * Qué le falta a cada punto para que su dinero llegue entero.
 *
 * Sin esto un punto mal configurado se ve **idéntico** a uno perfecto en el listado, y solo
 * se descubre cuando el cierre no se puede contabilizar — o sea, cuando ya se vendió.
 * Devuelve las monedas aceptadas sin caja de Tesorería y si le falta el almacén.
 */
export async function saludCajas(): Promise<Record<string, { monedasSinCuenta: string[]; sinAlmacen: boolean }>> {
  const session = await getPortalSession()
  if (!session) return {}
  const db = createAdminClient()

  const [cajasRes, cliRes] = await Promise.all([
    db.from('cajas').select('caja_id, empresa_id, monedas_aceptadas, cuentas_moneda, almacen_id, activa')
      .eq('client_id', session.client_id).eq('activa', true),
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).maybeSingle(),
  ])
  const modulos   = cliRes.data?.modulos_activos
  const tieneBase = tieneModulo(modulos, 'base')
  const tieneInv  = tieneModulo(modulos, 'inventario')

  const out: Record<string, { monedasSinCuenta: string[]; sinAlmacen: boolean }> = {}
  type Fila = { caja_id: string; monedas_aceptadas: string[] | null; cuentas_moneda: Record<string, string> | null; almacen_id: string | null }
  for (const c of ((cajasRes.data ?? []) as Fila[])) {
    const faltan = tieneBase
      ? (c.monedas_aceptadas ?? []).filter(m => !c.cuentas_moneda?.[m])
      : []
    const sinAlmacen = tieneInv && !c.almacen_id
    if (faltan.length || sinAlmacen) out[c.caja_id] = { monedasSinCuenta: faltan, sinAlmacen }
  }
  return out
}

// ── Crear caja ────────────────────────────────────────────────────────────────

export async function crearCaja(
  nombre: string, empresa_id: string,
): Promise<{ ok: boolean; caja_id?: string; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!nombre?.trim())      return { ok: false, error: 'El nombre de la caja es obligatorio.' }

  const db       = createAdminClient()
  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  // **Un punto de venta no nace roto.** Antes se aceptaban TODAS las monedas activas con
  // `cuentas_moneda` vacío: exactamente el estado que `guardarConfigCaja` se niega a
  // guardar, solo que por la puerta de atrás y sin que el dueño pase nunca por esa
  // pantalla. Vender así produce un cierre que no se puede contabilizar (le falta la caja
  // de Tesorería de esa moneda) y hasta la Fase 2 no había forma de recuperarlo.
  // Con Contabilidad se aceptan solo las monedas que YA tienen una cuenta en esta empresa;
  // sin ella no hay nada que mapear y valen todas, como hasta ahora.
  const [monsRes, cuentasRes] = await Promise.all([
    db.from('monedas').select('codigo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).maybeSingle(),
  ])
  const activas = ((monsRes.data ?? []) as { codigo: string }[]).map(m => m.codigo)

  let monedas = activas
  if (tieneModulo(cuentasRes.data?.modulos_activos, 'base')) {
    const { data: ctas } = await db.from('cuentas')
      .select('moneda').eq('client_id', session.client_id).eq('empresa_id', empresa_id)
      .eq('activa', true).eq('es_apertura', false)
    const conCuenta = new Set(((ctas ?? []) as { moneda: string }[]).map(c => c.moneda))
    monedas = activas.filter(m => conCuenta.has(m))
  }

  const caja_id = generarCajaId()
  const { error } = await db.from('cajas').insert({
    caja_id,
    client_id:         session.client_id,
    empresa_id,
    nombre:            nombre.trim(),
    monedas_aceptadas: monedas,
    cuentas_moneda:    {},
    sync_token:        generarToken(),
    activa:            true,
    updated_at:        new Date().toISOString(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/caja')
  return { ok: true, caja_id }
}

// ── Puntos de venta que aceptan una moneda ──────────────────────────────────────

// Lectura para avisar en «Monedas y tasas» antes de desactivar una moneda: si algún
// punto de venta la acepta, dejará de poder cobrar en ella en cuanto sincronice, y sin
// esto se enteraría el cajero en el mostrador. Devuelve NOMBRES porque el aviso los
// enumera. `monedas_aceptadas` es text[], así que la consulta es de contención, no de
// igualdad. Sin candado de escritura: no muta nada.
export async function puntosVentaConMoneda(codigo: string): Promise<string[]> {
  const session = await getPortalSession()
  if (!session) return []
  const { data } = await createAdminClient().from('cajas')
    .select('nombre')
    .eq('client_id', session.client_id).eq('activa', true)
    .contains('monedas_aceptadas', [codigo])
    .order('nombre')
  return ((data ?? []) as { nombre: string }[]).map(c => c.nombre)
}

// ── Datos de configuración de una caja ──────────────────────────────────────────

export async function obtenerCajaConfig(caja_id: string): Promise<CajaConfigData | null> {
  const session = await getPortalSession()
  if (!session) return null
  const db = createAdminClient()

  const { data: caja } = await db.from('cajas').select('*')
    .eq('caja_id', caja_id).eq('client_id', session.client_id).maybeSingle()
  if (!caja) return null

  const empresas = await obtenerEmpresas()
  const ids      = empresas.map(e => e.empresa_id)

  const [almRes, cuRes, monRes, cliRes, sesRes] = await Promise.all([
    db.from('almacenes').select('almacen_id, nombre, empresa_id')
      .eq('client_id', session.client_id).in('empresa_id', ids.length ? ids : ['__none__']).order('nombre'),
    db.from('cuentas').select('cuenta_id, nombre, moneda, empresa_id')
      .eq('client_id', session.client_id).eq('activa', true)
      .eq('es_apertura', false)   // técnica de la migración (mig. 130): no es caja
      .in('empresa_id', ids.length ? ids : ['__none__']).order('nombre'),
    db.from('monedas').select('codigo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).maybeSingle(),
    // head+count: solo interesa si existe alguna, no traer las filas.
    db.from('caja_sesiones').select('sesion_uuid', { count: 'exact', head: true })
      .eq('caja_id', caja_id).eq('client_id', session.client_id),
  ])

  const modulos = cliRes.data?.modulos_activos

  // Los servicios suscribibles que ALGUIEN tiene contratado: es la condición del doble
  // conteo. Un suscribible que nadie ha contratado todavía no puede duplicar nada.
  let suscribibles = 0
  if (tieneModulo(modulos, 'servicios')) {
    const { data: lins } = await db.from('suscripcion_lineas')
      .select('producto_id').eq('client_id', session.client_id)
    const ids = [...new Set(((lins ?? []) as { producto_id: string }[]).map(l => l.producto_id))]
    if (ids.length) {
      const { count } = await db.from('products').select('producto_id', { count: 'exact', head: true })
        .eq('client_id', session.client_id).eq('es_suscribible', true)
        .eq('estado', 'ACTIVO').in('producto_id', ids)
      suscribibles = count ?? 0
    }
  }

  return {
    caja: caja as Caja,
    empresas:  empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    almacenes: (almRes.data ?? []) as CajaConfigData['almacenes'],
    cuentas:   (cuRes.data  ?? []) as CajaConfigData['cuentas'],
    monedas:   ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo),
    baseUrl:   (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, ''),
    tieneBase:       tieneModulo(modulos, 'base'),
    tieneInventario: tieneModulo(modulos, 'inventario'),
    tieneServicios:  tieneModulo(modulos, 'servicios'),
    suscribiblesActivos: suscribibles,
    tieneHistorico:  (sesRes.count ?? 0) > 0,
  }
}

// ── Guardar configuración ───────────────────────────────────────────────────────

export async function guardarConfigCaja(
  caja_id: string,
  cfg: {
    nombre: string; empresa_id?: string; almacen_id: string | null
    monedas_aceptadas: string[]; cuentas_moneda: Record<string, string>
    cuentas_transferencia?: Record<string, string>
    tipos_catalogo?: string
  },
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!cfg.nombre?.trim())  return { ok: false, error: 'El nombre es obligatorio.' }

  const db = createAdminClient()

  // La empresa determina de qué almacén descuenta stock y a qué cuentas de Tesorería
  // postea, así que un cambio arrastra las dos cosas: el almacén y las cuentas eran
  // de la empresa vieja y ahí dejarían de existir. Se limpian EN SERVIDOR y no solo
  // en el formulario, porque es una invariante del dato: un punto de venta no puede
  // apuntar a un almacén ni a una cuenta de otra empresa, venga la petición de donde
  // venga. Lo ya sincronizado no se toca: las sesiones y los tickets llevan su propio
  // empresa_id y los resúmenes ya posteados viven en la contabilidad de la vieja.
  const { data: actual } = await db.from('cajas').select('empresa_id')
    .eq('caja_id', caja_id).eq('client_id', session.client_id).maybeSingle()
  if (!actual) return { ok: false, error: 'Punto de venta no encontrado.' }

  let empresaFinal = actual.empresa_id as string
  if (cfg.empresa_id && cfg.empresa_id !== actual.empresa_id) {
    const empresas = await obtenerEmpresas()
    if (!empresas.some(e => e.empresa_id === cfg.empresa_id)) {
      return { ok: false, error: 'Empresa no válida.' }
    }
    empresaFinal = cfg.empresa_id
  }

  // No se limpia a ciegas por «ha cambiado la empresa»: eso tiraría el almacén y las
  // cuentas que el usuario acaba de elegir para la empresa NUEVA en el mismo guardado.
  // Se comprueba la pertenencia real y se cae solo lo que no es de `empresaFinal`.
  const [almOk, cuentasEmpresa] = await Promise.all([
    cfg.almacen_id
      ? db.from('almacenes').select('almacen_id').eq('almacen_id', cfg.almacen_id)
          .eq('client_id', session.client_id).eq('empresa_id', empresaFinal).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('cuentas').select('cuenta_id')
      .eq('client_id', session.client_id).eq('empresa_id', empresaFinal)
      .eq('es_apertura', false),   // una caja no puede depositar en la cuenta técnica
  ])
  const cuentasValidas = new Set((cuentasEmpresa.data ?? []).map((c: { cuenta_id: string }) => c.cuenta_id))
  const soloDeLaEmpresa = (mapa: Record<string, string> | undefined) => {
    const out: Record<string, string> = {}
    for (const [moneda, cuentaId] of Object.entries(mapa ?? {})) {
      if (cuentasValidas.has(cuentaId)) out[moneda] = cuentaId
    }
    return out
  }
  const cuentasFinal = soloDeLaEmpresa(cfg.cuentas_moneda)
  // Misma guardia para la cuenta de transferencias: es una invariante del dato (un punto
  // no puede depositar en la cuenta de otra empresa), no una validación del formulario.
  const transfFinal  = soloDeLaEmpresa(cfg.cuentas_transferencia)

  const { error } = await db.from('cajas').update({
    nombre:            cfg.nombre.trim(),
    empresa_id:        empresaFinal,
    almacen_id:        almOk.data ? cfg.almacen_id : null,
    monedas_aceptadas: cfg.monedas_aceptadas ?? [],
    cuentas_moneda:    cuentasFinal,
    cuentas_transferencia: transfFinal,
    // Guardia de servidor: la columna tiene CHECK, y un valor inventado reventaría el
    // guardado entero en vez de ignorarse.
    tipos_catalogo:    (TIPOS_CATALOGO as readonly string[]).includes(cfg.tipos_catalogo ?? '') ? cfg.tipos_catalogo : 'PRODUCTO',
    updated_at:        new Date().toISOString(),
  }).eq('caja_id', caja_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/caja')
  revalidatePath(`/portal/caja/${caja_id}`)
  return { ok: true }
}

// ── Regenerar token / activar-desactivar ────────────────────────────────────────

export async function regenerarToken(caja_id: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const token = generarToken()
  const { error } = await createAdminClient().from('cajas')
    .update({ sync_token: token, updated_at: new Date().toISOString() })
    .eq('caja_id', caja_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/caja/${caja_id}`)
  return { ok: true, token }
}

export async function setActivaCaja(caja_id: string, activa: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const { error } = await createAdminClient().from('cajas')
    .update({ activa, updated_at: new Date().toISOString() })
    .eq('caja_id', caja_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/caja')
  return { ok: true }
}

// ── Operaciones (detalle: Ventas + Movimientos de stock) ─────────────────────────

/**
 * Ventas del TPV y sus movimientos de stock.
 *
 * Traía `.limit(1000)` **sin rango, sin aviso y sin forma de traer más**, y la vista encima
 * filtra en el navegador por punto de venta y búsqueda: un negocio de mostrador con más de
 * 1.000 tickets no veía los viejos y no había ni una pista de que faltaran. Es el mismo fallo
 * que ya se corrigió en Gastos y cobros (`lib/listados.ts`), aquí con más volumen todavía —un
 * TPV escribe un ticket por venta—. Ahora: rango por defecto de 3 meses aplicado EN LA
 * CONSULTA, `count: 'exact'` para poder decir cuántos faltan, y techo que sube con «Traer más».
 */
export async function listarOperaciones(
  filtro?: FiltroListado,
): Promise<{
  tickets: Ticket[]; stock: MovimientoStock[]; cajaNombres: Record<string, string>
  lineasPorTicket: Record<string, { descripcion: string; cantidad: number; precio_unitario: number }[]>
  rango: { desde: string; hasta: string }; hay_mas: boolean; total: number; limite: number
}> {
  const session = await getPortalSession()
  const vacio = { desde: '', hasta: '' }
  if (!session) return { tickets: [], stock: [], cajaNombres: {}, lineasPorTicket: {}, rango: vacio, hay_mas: false, total: 0, limite: LIMITE_LISTADO }
  const db  = createAdminClient()
  const ids = await empresaIds()
  const scope = ids.length ? ids : ['__none__']

  const porDefecto = rangoUltimosMeses(3)
  const desde  = filtro?.desde ?? porDefecto.desde
  const hasta  = filtro?.hasta ?? porDefecto.hasta
  const limite = limiteDelFiltro(filtro)

  let tkQuery = db.from('caja_tickets')
    .select('ticket_uuid, caja_id, fecha, moneda, total, medio_pago, sesion_uuid, estado', { count: 'exact' })
    .eq('client_id', session.client_id).in('empresa_id', scope)
  // `fecha` es un timestamp: el «hasta» incluye el día entero, o las ventas de hoy se
  // quedarían fuera de un rango que dice llegar hasta hoy. Y los dos extremos van en el
  // calendario del NEGOCIO: con una fecha desnuda Postgres las lee en UTC, así que el rango
  // se comía las ventas de después de las 20:00 hora de Cuba del último día — las de más
  // venta en un restaurante.
  if (desde) tkQuery = tkQuery.gte('fecha', diaDelNegocio(desde).inicio)
  if (hasta) tkQuery = tkQuery.lte('fecha', diaDelNegocio(hasta).fin)

  const [tkRes, cajasRes] = await Promise.all([
    tkQuery.order('fecha', { ascending: false }).limit(limite),
    db.from('cajas').select('caja_id, nombre').eq('client_id', session.client_id),
  ])

  const tickets = (tkRes.data ?? []) as Ticket[]
  const cajaNombres: Record<string, string> = {}
  for (const c of (cajasRes.data ?? []) as { caja_id: string; nombre: string }[]) cajaNombres[c.caja_id] = c.nombre

  // Líneas (movimientos de stock detallados) de esos tickets. Se excluyen las de
  // tickets ANULADO (rectificados: no movieron stock) y se ordena por fecha desc.
  const uuids = tickets.map(t => t.ticket_uuid)
  let stock: MovimientoStock[] = []
  let lineasPorTicket: Record<string, { descripcion: string; cantidad: number; precio_unitario: number }[]> = {}
  if (uuids.length) {
    const { data: lineas } = await db.from('caja_ticket_lineas')
      .select('ticket_uuid, producto_id, descripcion, cantidad, precio_unitario')
      .in('ticket_uuid', uuids)

    // Las mismas líneas, agrupadas por ticket: es lo que permite DESPLEGAR una venta y ver
    // qué llevaba sin irse a la otra pestaña a cruzarlo a ojo.
    lineasPorTicket = {}
    for (const l of ((lineas ?? []) as { ticket_uuid: string; descripcion: string; cantidad: number; precio_unitario: number }[])) {
      ;(lineasPorTicket[l.ticket_uuid] ??= []).push({
        descripcion: l.descripcion, cantidad: Number(l.cantidad), precio_unitario: Number(l.precio_unitario),
      })
    }
    const tkMap = new Map(tickets.map(t => [t.ticket_uuid, t]))
    stock = ((lineas ?? []) as Omit<MovimientoStock, 'fecha' | 'caja_id'>[])
      .filter(l => (tkMap.get(l.ticket_uuid)?.estado ?? 'VIGENTE') !== 'ANULADO')
      .map(l => {
        const tk = tkMap.get(l.ticket_uuid)
        return { ...l, fecha: tk?.fecha ?? '', caja_id: tk?.caja_id ?? '' }
      })
      .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
  }

  return {
    tickets, stock, cajaNombres, lineasPorTicket,
    rango: { desde, hasta },
    hay_mas: tickets.length >= limite,
    total:   tkRes.count ?? tickets.length,
    limite,
  }
}

// ── Cierres ─────────────────────────────────────────────────────────────────────

/** Cierres de caja. Mismo contrato que Operaciones: `.limit(500)` sin aviso escondía los
 *  cierres viejos —y con ellos la serie de números Z, que es lo que se audita—. */
export async function listarCierres(
  filtro?: FiltroListado,
): Promise<{
  cierres: Cierre[]; cajaNombres: Record<string, string>
  hay_mas: boolean; total: number; limite: number
}> {
  const session = await getPortalSession()
  if (!session) return { cierres: [], cajaNombres: {}, hay_mas: false, total: 0, limite: LIMITE_LISTADO }
  const db  = createAdminClient()
  const ids = await empresaIds()
  const scope = ids.length ? ids : ['__none__']
  const limite = limiteDelFiltro(filtro)

  const [seRes, cajasRes] = await Promise.all([
    db.from('caja_sesiones')
      .select('sesion_uuid, caja_id, abierta_at, cerrada_at, estado, total_por_moneda, efectivo_contado, posted_at, tesoreria_movs, stock_movs', { count: 'exact' })
      .eq('client_id', session.client_id).in('empresa_id', scope)
      // **Solo los CERRADOS.** Desde que el dispositivo sube también el turno ABIERTO —lo
      // que permite avisar de que lleva días sin cerrar y rescatarlo—, esta pantalla
      // recibiría turnos en curso con la fecha de cierre vacía, sin totales y con la
      // contabilidad en «Pendiente»: indistinguibles de un cierre que falló. Un turno
      // abierto no es un cierre; su sitio es el panel de rescate.
      .eq('estado', 'CERRADA')
      .order('cerrada_at', { ascending: false, nullsFirst: false }).limit(limite),
    db.from('cajas').select('caja_id, nombre').eq('client_id', session.client_id),
  ])

  const cajaNombres: Record<string, string> = {}
  for (const c of (cajasRes.data ?? []) as { caja_id: string; nombre: string }[]) cajaNombres[c.caja_id] = c.nombre
  const cierres = (seRes.data ?? []) as Cierre[]
  return {
    cierres, cajaNombres,
    hay_mas: cierres.length >= limite,
    total:   seRes.count ?? cierres.length,
    limite,
  }
}

// ── Rescate: las ventas que no llegaron a la contabilidad ───────────────────────

/**
 * Un grupo de ventas cuyo turno no se ha cerrado, y por tanto **no está en los libros**.
 * `motivo`: `ABIERTA` (el turno existe y sigue abierto) · `SIN_SESION` (su turno nunca
 * llegó — histórico anterior a que el dispositivo subiera la sesión abierta).
 */
export interface PendienteContabilizar {
  caja_id:     string
  sesion_uuid: string
  motivo:      'ABIERTA' | 'SIN_SESION'
  desde:       string
  hasta:       string
  tickets:     number
  totales:     Record<string, number>
}

/** LECTURA: sin candado de escritura, el de la página basta. */
export async function listarSinContabilizar(): Promise<{
  grupos: PendienteContabilizar[]; cajaNombres: Record<string, string>
}> {
  const session = await getPortalSession()
  if (!session) return { grupos: [], cajaNombres: {} }
  const db  = createAdminClient()
  const ids = await empresaIds()
  if (!ids.length) return { grupos: [], cajaNombres: {} }

  const [rpc, cajasRes] = await Promise.all([
    db.rpc('caja_pendientes_contabilizar', { p_client_id: session.client_id, p_empresa_ids: ids }),
    db.from('cajas').select('caja_id, nombre').eq('client_id', session.client_id),
  ])
  // El error NO se traga: un `?? []` aquí diría «no falta nada», que es la conclusión
  // contraria y la más cara de todas. Es la trampa que ya dejó ciega la facturación manual.
  if (rpc.error) throw new Error(`No se pudo calcular lo pendiente: ${rpc.error.message}`)

  const cajaNombres: Record<string, string> = {}
  for (const c of (cajasRes.data ?? []) as { caja_id: string; nombre: string }[]) cajaNombres[c.caja_id] = c.nombre

  return {
    grupos: ((rpc.data ?? []) as PendienteContabilizar[]).map(g => ({ ...g, totales: g.totales ?? {} })),
    cajaNombres,
  }
}

/**
 * Cierra un turno olvidado DESDE EL PORTAL y lo contabiliza.
 *
 * Red de seguridad, no camino normal — el gemelo de «Recalcular» en Inventario. El cierre se
 * fecha con el **último ticket**, nunca «hoy»: el dinero es del día en que se vendió, y
 * fecharlo hoy lo metería en el mes equivocado.
 */
export async function cerrarYContabilizar(
  caja_id: string, sesion_uuid: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: caja } = await db.from('cajas')
    .select('caja_id, client_id, empresa_id, nombre, almacen_id, cuentas_moneda, cuentas_transferencia, monedas_aceptadas, tipos_catalogo, activa')
    .eq('caja_id', caja_id).eq('client_id', session.client_id).maybeSingle()
  if (!caja) return { ok: false, error: 'Punto de venta no encontrado.' }

  // Tickets sin `sesion_uuid` (histórico): la RPC los agrupa por caja y día con una clave
  // sintética `SIN-TURNO-<caja>-<fecha>`. Adoptarlos es darles ese turno, y como la clave
  // es estable, repetir la operación no crea un segundo turno ni mueve nada dos veces.
  if (sesion_uuid.startsWith('SIN-TURNO-')) {
    const dia = sesion_uuid.slice(-10)
    const { error } = await db.rpc('caja_adoptar_tickets_sueltos', {
      p_client_id: session.client_id, p_caja_id: caja_id, p_dia: dia, p_sesion_uuid: sesion_uuid,
    })
    if (error) return { ok: false, error: error.message }
  }

  // Rango real de la jornada, leído de sus tickets.
  const { data: tks } = await db.from('caja_tickets')
    .select('fecha').eq('client_id', session.client_id).eq('sesion_uuid', sesion_uuid)
    .order('fecha', { ascending: true })
  const fechas = (tks ?? []) as { fecha: string }[]
  if (!fechas.length) return { ok: false, error: 'Ese turno ya no tiene ventas que contabilizar.' }

  const { error: sesErr } = await db.from('caja_sesiones').upsert({
    sesion_uuid,
    caja_id:         caja.caja_id,
    client_id:       session.client_id,
    empresa_id:      caja.empresa_id,
    abierta_at:      fechas[0].fecha,
    cerrada_at:      fechas[fechas.length - 1].fecha,
    estado:          'CERRADA',
    sincronizado_at: new Date().toISOString(),
  }, { onConflict: 'sesion_uuid' })
  if (sesErr) return { ok: false, error: sesErr.message }

  try {
    await contabilizarCierre(db, caja as CajaRow, sesion_uuid)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo contabilizar.' }
  }

  revalidarCaja(caja_id)
  return { ok: true }
}

/**
 * Reintenta contabilizar un cierre YA cerrado.
 *
 * Es la vuelta que faltaba: si una moneda no tenía su caja de Tesorería, el cierre se
 * quedaba a medias, el badge decía «Falta CUP» y no había forma de arreglarlo — el
 * dispositivo ya lo dio por enviado y no lo reenvía nunca. Idempotente: solo escribe lo que
 * falte, así que pulsarlo dos veces no duplica nada.
 */
export async function reintentarContabilizar(
  sesion_uuid: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: ses } = await db.from('caja_sesiones')
    .select('caja_id').eq('sesion_uuid', sesion_uuid).eq('client_id', session.client_id).maybeSingle()
  if (!ses) return { ok: false, error: 'Cierre no encontrado.' }

  const { data: caja } = await db.from('cajas')
    .select('caja_id, client_id, empresa_id, nombre, almacen_id, cuentas_moneda, cuentas_transferencia, monedas_aceptadas, tipos_catalogo, activa')
    .eq('caja_id', ses.caja_id).eq('client_id', session.client_id).maybeSingle()
  if (!caja) return { ok: false, error: 'Punto de venta no encontrado.' }

  try {
    await contabilizarCierre(db, caja as CajaRow, sesion_uuid)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo contabilizar.' }
  }

  revalidarCaja(ses.caja_id as string)
  return { ok: true }
}

// ── Subir archivo para sincronizar (fallback sin conexión) ──────────────────────

export async function ingestarLoteArchivo(
  caja_id: string, payload: LotePayload,
): Promise<{ ok: boolean; resultado?: Awaited<ReturnType<typeof ingestarLote>>; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  // El archivo dice de qué punto de venta salió. Manda ÉL, no lo que haya elegido la
  // vista: ingerir las ventas de un punto en otro las mete en la empresa equivocada,
  // descuenta del almacén equivocado y postea a la cuenta equivocada, y una vez dentro
  // no hay deshacer. La comprobación va en servidor porque el cliente se puede saltar.
  const destino = typeof payload?.caja === 'string' && payload.caja ? payload.caja : caja_id
  if (destino !== caja_id) {
    return { ok: false, error: 'El archivo es de otro punto de venta que el seleccionado.' }
  }

  const db = createAdminClient()
  const { data: caja } = await db.from('cajas')
    .select('caja_id, client_id, empresa_id, nombre, almacen_id, cuentas_moneda, cuentas_transferencia, monedas_aceptadas, tipos_catalogo, activa')
    .eq('caja_id', destino).eq('client_id', session.client_id).maybeSingle()
  if (!caja) return { ok: false, error: 'Punto de venta no encontrado.' }

  const resultado = await ingestarLote(db, caja as CajaRow, payload, 'ARCHIVO')

  revalidatePath('/portal/caja/operaciones')
  revalidatePath('/portal/caja/cierres')
  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/inventario')
  return { ok: true, resultado }
}
