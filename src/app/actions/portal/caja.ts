'use server'

// Server actions del módulo Caja (portal del dueño). Gestión de instancias de
// caja (crear/config/token), lectura del detalle (operaciones + movimientos de
// stock + cierres) y subida de archivo para sincronizar sin conexión.
// El detalle vive en las tablas del módulo; los efectos en Tesorería/Inventario
// los aplica el núcleo compartido (@/lib/caja/ingesta), no estas acciones.

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
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
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function generarCajaId(): string {
  return `CAJ-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
function generarToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
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
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
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

  const [almRes, cuRes, monRes, cliRes] = await Promise.all([
    db.from('almacenes').select('almacen_id, nombre, empresa_id')
      .eq('client_id', session.client_id).in('empresa_id', ids.length ? ids : ['__none__']).order('nombre'),
    db.from('cuentas').select('cuenta_id, nombre, moneda, empresa_id')
      .eq('client_id', session.client_id).eq('activa', true)
      .in('empresa_id', ids.length ? ids : ['__none__']).order('nombre'),
    db.from('monedas').select('codigo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).maybeSingle(),
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
  }
}

// ── Guardar configuración ───────────────────────────────────────────────────────

export async function guardarConfigCaja(
  caja_id: string,
  cfg: { nombre: string; almacen_id: string | null; monedas_aceptadas: string[]; cuentas_moneda: Record<string, string> },
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!cfg.nombre?.trim())  return { ok: false, error: 'El nombre es obligatorio.' }

  const db = createAdminClient()
  const { error } = await db.from('cajas').update({
    nombre:            cfg.nombre.trim(),
    almacen_id:        cfg.almacen_id || null,
    monedas_aceptadas: cfg.monedas_aceptadas ?? [],
    cuentas_moneda:    cfg.cuentas_moneda ?? {},
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
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

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
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

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
      .select('ticket_uuid, caja_id, fecha, moneda, total, medio_pago, sesion_uuid')
      .eq('client_id', session.client_id).in('empresa_id', scope)
      .order('fecha', { ascending: false }).limit(1000),
    db.from('cajas').select('caja_id, nombre').eq('client_id', session.client_id),
  ])

  const tickets = (tkRes.data ?? []) as Ticket[]
  const cajaNombres: Record<string, string> = {}
  for (const c of (cajasRes.data ?? []) as { caja_id: string; nombre: string }[]) cajaNombres[c.caja_id] = c.nombre

  // Líneas (movimientos de stock detallados) de esos tickets.
  const uuids = tickets.map(t => t.ticket_uuid)
  let stock: MovimientoStock[] = []
  if (uuids.length) {
    const { data: lineas } = await db.from('caja_ticket_lineas')
      .select('ticket_uuid, producto_id, descripcion, cantidad, precio_unitario')
      .in('ticket_uuid', uuids)
    const tkMap = new Map(tickets.map(t => [t.ticket_uuid, t]))
    stock = ((lineas ?? []) as Omit<MovimientoStock, 'fecha' | 'caja_id'>[]).map(l => {
      const tk = tkMap.get(l.ticket_uuid)
      return { ...l, fecha: tk?.fecha ?? '', caja_id: tk?.caja_id ?? '' }
    })
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
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { data: caja } = await db.from('cajas')
    .select('caja_id, client_id, empresa_id, almacen_id, cuentas_moneda, monedas_aceptadas, activa')
    .eq('caja_id', caja_id).eq('client_id', session.client_id).maybeSingle()
  if (!caja) return { ok: false, error: 'Caja no encontrada.' }

  const resultado = await ingestarLote(db, caja as CajaRow, payload, 'ARCHIVO')

  revalidatePath('/portal/caja/operaciones')
  revalidatePath('/portal/caja/cierres')
  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/inventario')
  return { ok: true, resultado }
}
