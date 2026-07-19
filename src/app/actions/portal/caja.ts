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
import { ingestarLote, type LotePayload, type CajaRow } from '@/lib/caja/ingesta'
import { tieneModulo }      from '@/lib/modulos'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface Caja {
  caja_id:           string
  client_id:         string
  empresa_id:        string
  nombre:            string
  almacen_id:        string | null
  cuentas_moneda:    Record<string, string>
  monedas_aceptadas: string[]
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

  // Monedas activas del cliente como aceptadas por defecto (se afinan en config).
  const { data: mons } = await db.from('monedas')
    .select('codigo').eq('client_id', session.client_id).eq('activa', true).order('codigo')
  const monedas = (mons ?? []).map((m: { codigo: string }) => m.codigo)

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
      .in('empresa_id', ids.length ? ids : ['__none__']).order('nombre'),
    db.from('monedas').select('codigo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).maybeSingle(),
    // head+count: solo interesa si existe alguna, no traer las filas.
    db.from('caja_sesiones').select('sesion_uuid', { count: 'exact', head: true })
      .eq('caja_id', caja_id).eq('client_id', session.client_id),
  ])

  const modulos = cliRes.data?.modulos_activos
  return {
    caja: caja as Caja,
    empresas:  empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    almacenes: (almRes.data ?? []) as CajaConfigData['almacenes'],
    cuentas:   (cuRes.data  ?? []) as CajaConfigData['cuentas'],
    monedas:   ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo),
    baseUrl:   (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, ''),
    tieneBase:       tieneModulo(modulos, 'base'),
    tieneInventario: tieneModulo(modulos, 'inventario'),
    tieneHistorico:  (sesRes.count ?? 0) > 0,
  }
}

// ── Guardar configuración ───────────────────────────────────────────────────────

export async function guardarConfigCaja(
  caja_id: string,
  cfg: {
    nombre: string; empresa_id?: string; almacen_id: string | null
    monedas_aceptadas: string[]; cuentas_moneda: Record<string, string>
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
      .eq('client_id', session.client_id).eq('empresa_id', empresaFinal),
  ])
  const cuentasValidas = new Set((cuentasEmpresa.data ?? []).map((c: { cuenta_id: string }) => c.cuenta_id))
  const cuentasFinal: Record<string, string> = {}
  for (const [moneda, cuentaId] of Object.entries(cfg.cuentas_moneda ?? {})) {
    if (cuentasValidas.has(cuentaId)) cuentasFinal[moneda] = cuentaId
  }

  const { error } = await db.from('cajas').update({
    nombre:            cfg.nombre.trim(),
    empresa_id:        empresaFinal,
    almacen_id:        almOk.data ? cfg.almacen_id : null,
    monedas_aceptadas: cfg.monedas_aceptadas ?? [],
    cuentas_moneda:    cuentasFinal,
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

export async function listarOperaciones(): Promise<{ tickets: Ticket[]; stock: MovimientoStock[]; cajaNombres: Record<string, string> }> {
  const session = await getPortalSession()
  if (!session) return { tickets: [], stock: [], cajaNombres: {} }
  const db  = createAdminClient()
  const ids = await empresaIds()
  const scope = ids.length ? ids : ['__none__']

  const [tkRes, cajasRes] = await Promise.all([
    db.from('caja_tickets')
      .select('ticket_uuid, caja_id, fecha, moneda, total, medio_pago, sesion_uuid, estado')
      .eq('client_id', session.client_id).in('empresa_id', scope)
      .order('fecha', { ascending: false }).limit(1000),
    db.from('cajas').select('caja_id, nombre').eq('client_id', session.client_id),
  ])

  const tickets = (tkRes.data ?? []) as Ticket[]
  const cajaNombres: Record<string, string> = {}
  for (const c of (cajasRes.data ?? []) as { caja_id: string; nombre: string }[]) cajaNombres[c.caja_id] = c.nombre

  // Líneas (movimientos de stock detallados) de esos tickets. Se excluyen las de
  // tickets ANULADO (rectificados: no movieron stock) y se ordena por fecha desc.
  const uuids = tickets.map(t => t.ticket_uuid)
  let stock: MovimientoStock[] = []
  if (uuids.length) {
    const { data: lineas } = await db.from('caja_ticket_lineas')
      .select('ticket_uuid, producto_id, descripcion, cantidad, precio_unitario')
      .in('ticket_uuid', uuids)
    const tkMap = new Map(tickets.map(t => [t.ticket_uuid, t]))
    stock = ((lineas ?? []) as Omit<MovimientoStock, 'fecha' | 'caja_id'>[])
      .filter(l => (tkMap.get(l.ticket_uuid)?.estado ?? 'VIGENTE') !== 'ANULADO')
      .map(l => {
        const tk = tkMap.get(l.ticket_uuid)
        return { ...l, fecha: tk?.fecha ?? '', caja_id: tk?.caja_id ?? '' }
      })
      .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
  }

  return { tickets, stock, cajaNombres }
}

// ── Cierres ─────────────────────────────────────────────────────────────────────

export async function listarCierres(): Promise<{ cierres: Cierre[]; cajaNombres: Record<string, string> }> {
  const session = await getPortalSession()
  if (!session) return { cierres: [], cajaNombres: {} }
  const db  = createAdminClient()
  const ids = await empresaIds()
  const scope = ids.length ? ids : ['__none__']

  const [seRes, cajasRes] = await Promise.all([
    db.from('caja_sesiones')
      .select('sesion_uuid, caja_id, abierta_at, cerrada_at, estado, total_por_moneda, efectivo_contado, posted_at, tesoreria_movs, stock_movs')
      .eq('client_id', session.client_id).in('empresa_id', scope)
      .order('cerrada_at', { ascending: false, nullsFirst: false }).limit(500),
    db.from('cajas').select('caja_id, nombre').eq('client_id', session.client_id),
  ])

  const cajaNombres: Record<string, string> = {}
  for (const c of (cajasRes.data ?? []) as { caja_id: string; nombre: string }[]) cajaNombres[c.caja_id] = c.nombre
  return { cierres: (seRes.data ?? []) as Cierre[], cajaNombres }
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
    .select('caja_id, client_id, empresa_id, almacen_id, cuentas_moneda, monedas_aceptadas, activa')
    .eq('caja_id', destino).eq('client_id', session.client_id).maybeSingle()
  if (!caja) return { ok: false, error: 'Punto de venta no encontrado.' }

  const resultado = await ingestarLote(db, caja as CajaRow, payload, 'ARCHIVO')

  revalidatePath('/portal/caja/operaciones')
  revalidatePath('/portal/caja/cierres')
  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/inventario')
  return { ok: true, resultado }
}
