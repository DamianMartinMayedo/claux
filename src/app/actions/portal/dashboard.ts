'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { getSetting }        from '@/app/actions/settings'
import { suscripcionLabel }  from '@/lib/billing'
import { obtenerEtiquetasNegocio } from './sector'
import { hoyEnTz, ahoraEnTz, sumarDias } from '@/lib/fecha-tz'
import type { EtiquetasSector } from '@/lib/sector'

// Dashboard del portal — ADAPTABLE a los módulos contratados. Solo se calculan
// y devuelven las secciones de los módulos que el cliente tiene activos, así que
// un cliente con una sola funcionalidad ve un dashboard útil (no vacío) y uno
// con todo ve todas las secciones. Addons (multiempresa) e IA quedan fuera.
// La contabilidad ('base') es un módulo más: solo aparece si está contratada.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const ESTADOS_AGENDA_ACTIVOS = ['PENDIENTE', 'CONFIRMADA']

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface SerieMes { mes: string; etiqueta: string; ventas: number; gastos: number }
export interface FacturaResumen {
  factura_id: string; numero: string; cliente_nombre: string
  fecha: string; total: number; estado: string
}
export interface ContabilidadResumen {
  ventasMes: number; gastosMes: number; netoMes: number
  caja: { moneda: string; saldo: number }[]
  serie: SerieMes[]
  ultimasFacturas: FacturaResumen[]
}
export interface InventarioResumen {
  totalProductos: number
  bajoMinimoCount: number
  bajoMinimo: { nombre: string; stock: number; minimo: number; unidad: string }[]
}
export interface RrhhResumen { activos: number; altasMes: number }
export interface AgendaItem { hora: string | null; nombre: string; personas: number; estado: string }
export interface AgendaResumen {
  hoyCount: number
  personasHoy: number
  proxima: { fecha: string; hora: string | null; nombre: string } | null
  hoyLista: AgendaItem[]
  serie7: { fecha: string; etiqueta: string; total: number }[]
}
export interface AccesoRapido { clave: string; label: string; ruta: string }

export interface DashboardData {
  nombreEmpresa: string
  fecha: string
  etiquetas: EtiquetasSector
  suscripcion: { estado: string; diasRestantes: number | null; label: string }
  contabilidad?: ContabilidadResumen
  inventario?: InventarioResumen
  rrhh?: RrhhResumen
  reservas?: AgendaResumen
  citas?: AgendaResumen
  accesos: AccesoRapido[]
}

// Accesos rápidos de fallback (módulos sin widget propio o cliente sin widgets).
// Fuera: addons (multiempresa) e IA (asistente_ia).
const ACCESOS: Record<string, { label: string; ruta: string }> = {
  base:               { label: 'Contabilidad', ruta: '/portal/ventas' },
  inventario:         { label: 'Inventario',   ruta: '/portal/inventario' },
  rrhh:               { label: 'Personal',     ruta: '/portal/rrhh' },
  reservas_citas:     { label: 'Reservas',     ruta: '/portal/reservas' },
  agenda:             { label: 'Citas',        ruta: '/portal/citas' },
  catalogo_qr:        { label: 'Catálogo',     ruta: '/portal/catalogo' },
  documentos_imprenta:{ label: 'Documentos',   ruta: '/portal/imprenta' },
}

// ── Helpers de fecha ────────────────────────────────────────────────────────────

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIAS_CORTOS  = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

function clavesMes(hoy: string, n: number): { mes: string; etiqueta: string }[] {
  const [y, m] = hoy.split('-').map(Number)
  const out: { mes: string; etiqueta: string }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    const mm = d.getUTCMonth()
    out.push({
      mes: `${d.getUTCFullYear()}-${String(mm + 1).padStart(2, '0')}`,
      etiqueta: MESES_CORTOS[mm],
    })
  }
  return out
}

function etiquetaDia(fechaISO: string): string {
  const [y, m, d] = fechaISO.split('-').map(Number)
  return DIAS_CORTOS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

// ── Builders por módulo ─────────────────────────────────────────────────────────

async function resumenContabilidad(db: Db, cid: string, hoy: string): Promise<ContabilidadResumen> {
  const meses = clavesMes(hoy, 6)
  const desde6 = `${meses[0].mes}-01`
  const mesActual = hoy.slice(0, 7)

  const [facturas6, gastos6, movimientos, ultimas] = await Promise.all([
    db.from('facturas').select('fecha_emision, total, moneda')
      .eq('client_id', cid).eq('estado', 'CONFIRMADO').gte('fecha_emision', desde6),
    db.from('gastos_cobros').select('fecha, monto')
      .eq('client_id', cid).eq('tipo', 'GASTO').gte('fecha', desde6),
    db.from('movimientos_tesoreria').select('monto, tipo, moneda').eq('client_id', cid),
    db.from('facturas').select('factura_id, numero, cliente_id, fecha_emision, total, estado')
      .eq('client_id', cid).order('fecha_emision', { ascending: false }).limit(5),
  ])

  // Serie mensual ventas/gastos
  const serieMap = new Map(meses.map(m => [m.mes, { ...m, ventas: 0, gastos: 0 }]))
  for (const f of (facturas6.data ?? [])) {
    const k = String(f.fecha_emision).slice(0, 7)
    const b = serieMap.get(k); if (b) b.ventas += Number(f.total) || 0
  }
  for (const g of (gastos6.data ?? [])) {
    const k = String(g.fecha).slice(0, 7)
    const b = serieMap.get(k); if (b) b.gastos += Number(g.monto) || 0
  }
  const serie = [...serieMap.values()]
  const mesBucket = serieMap.get(mesActual)
  const ventasMes = mesBucket?.ventas ?? 0
  const gastosMes = mesBucket?.gastos ?? 0

  // Caja por moneda
  const cajaMap = new Map<string, number>()
  for (const m of (movimientos.data ?? [])) {
    const delta = m.tipo === 'ENTRADA' ? Number(m.monto) : -Number(m.monto)
    cajaMap.set(m.moneda, (cajaMap.get(m.moneda) ?? 0) + (delta || 0))
  }
  const caja = [...cajaMap.entries()].filter(([, s]) => Math.abs(s) > 0.005).map(([moneda, saldo]) => ({ moneda, saldo }))

  // Nombres de terceros para últimas facturas
  const ids = [...new Set((ultimas.data ?? []).map((f: { cliente_id: string }) => f.cliente_id).filter(Boolean))]
  const { data: terceros } = ids.length
    ? await db.from('third_parties').select('tercero_id, nombre').eq('client_id', cid).in('tercero_id', ids)
    : { data: [] }
  const nombres = Object.fromEntries((terceros ?? []).map((t: { tercero_id: string; nombre: string }) => [t.tercero_id, t.nombre]))

  return {
    ventasMes, gastosMes, netoMes: ventasMes - gastosMes, caja, serie,
    ultimasFacturas: (ultimas.data ?? []).map((f: Record<string, unknown>) => ({
      factura_id: f.factura_id as string,
      numero: f.numero as string,
      cliente_nombre: nombres[f.cliente_id as string] ?? '—',
      fecha: f.fecha_emision as string,
      total: Number(f.total),
      estado: f.estado as string,
    })),
  }
}

async function resumenInventario(db: Db, cid: string): Promise<InventarioResumen> {
  const { data: productos } = await db
    .from('products')
    .select('nombre, stock_actual, stock_minimo, unidad, tipo, activo')
    .eq('client_id', cid).eq('activo', true).neq('tipo', 'SERVICIO')

  const lista = (productos ?? []) as { nombre: string; stock_actual: number; stock_minimo: number; unidad: string }[]
  const bajo = lista
    .filter(p => Number(p.stock_minimo) > 0 && Number(p.stock_actual) <= Number(p.stock_minimo))
    .map(p => ({ nombre: p.nombre, stock: Number(p.stock_actual) || 0, minimo: Number(p.stock_minimo) || 0, unidad: p.unidad ?? '' }))
    .sort((a, b) => (a.stock - a.minimo) - (b.stock - b.minimo))

  return { totalProductos: lista.length, bajoMinimoCount: bajo.length, bajoMinimo: bajo.slice(0, 5) }
}

async function resumenRrhh(db: Db, cid: string, hoy: string): Promise<RrhhResumen> {
  const inicioMes = `${hoy.slice(0, 7)}-01`
  const { data: empleados } = await db
    .from('empleados').select('fecha_alta, fecha_baja').eq('client_id', cid)

  const lista = (empleados ?? []) as { fecha_alta: string | null; fecha_baja: string | null }[]
  const activos = lista.filter(e => !e.fecha_baja).length
  const altasMes = lista.filter(e => !e.fecha_baja && e.fecha_alta && String(e.fecha_alta) >= inicioMes).length
  return { activos, altasMes }
}

async function resumenAgenda(db: Db, cid: string, hoy: string, tipo: 'reserva' | 'cita'): Promise<AgendaResumen> {
  const hasta = sumarDias(hoy, 6)
  let q = db.from('reservas')
    .select('fecha, hora, personas, estado, nombre_cliente')
    .eq('client_id', cid)
    .in('estado', ESTADOS_AGENDA_ACTIVOS)
    .gte('fecha', hoy).lte('fecha', hasta)
  q = tipo === 'cita' ? q.not('recurso_id', 'is', null) : q.is('recurso_id', null)
  const { data } = await q

  const filas = ((data ?? []) as { fecha: string; hora: string | null; personas: number | null; estado: string; nombre_cliente: string | null }[])
    .map(r => ({ fecha: String(r.fecha), hora: r.hora ? String(r.hora).slice(0, 5) : null, personas: Number(r.personas) || (tipo === 'cita' ? 1 : 0), estado: r.estado, nombre: r.nombre_cliente ?? '—' }))
    .sort((a, b) => (a.fecha + (a.hora ?? '')).localeCompare(b.fecha + (b.hora ?? '')))

  const deHoy = filas.filter(r => r.fecha === hoy)
  const ahora = ahoraEnTz().slice(0, 5)
  const proximaRow = filas.find(r => r.fecha > hoy || (r.fecha === hoy && (r.hora ?? '99:99') >= ahora)) ?? null

  // Serie de carga próximos 7 días
  const serie7 = Array.from({ length: 7 }, (_, i) => {
    const f = sumarDias(hoy, i)
    return { fecha: f, etiqueta: etiquetaDia(f), total: filas.filter(r => r.fecha === f).length }
  })

  return {
    hoyCount: deHoy.length,
    personasHoy: deHoy.reduce((s, r) => s + r.personas, 0),
    proxima: proximaRow ? { fecha: proximaRow.fecha, hora: proximaRow.hora, nombre: proximaRow.nombre } : null,
    hoyLista: deHoy.map(r => ({ hora: r.hora, nombre: r.nombre, personas: r.personas, estado: r.estado })),
    serie7,
  }
}

// ── Loader principal ─────────────────────────────────────────────────────────────

export async function obtenerDashboard(): Promise<DashboardData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const cid = session.client_id
  const hoy = hoyEnTz()

  const { data: cliente } = await db
    .from('clients')
    .select('nombre_empresa, estado, modulos_activos, precio_mensual_usd, ciclo_facturacion, fecha_expiracion')
    .eq('client_id', cid).single()
  if (!cliente) return null

  const activos: string[] = Array.isArray(cliente.modulos_activos) ? cliente.modulos_activos : []
  const tiene = (m: string) => activos.includes(m)

  const [contabilidad, inventario, rrhh, reservas, citas, etiquetas, descuentoRaw] = await Promise.all([
    tiene('base')           ? resumenContabilidad(db, cid, hoy)            : Promise.resolve(undefined),
    tiene('inventario')     ? resumenInventario(db, cid)                   : Promise.resolve(undefined),
    tiene('rrhh')           ? resumenRrhh(db, cid, hoy)                    : Promise.resolve(undefined),
    tiene('reservas_citas') ? resumenAgenda(db, cid, hoy, 'reserva')       : Promise.resolve(undefined),
    tiene('agenda')         ? resumenAgenda(db, cid, hoy, 'cita')          : Promise.resolve(undefined),
    obtenerEtiquetasNegocio(),
    getSetting('descuento_anual_pct', '10'),
  ])

  const descuento = parseInt(descuentoRaw, 10) || 0
  const precioMes = Number(cliente.precio_mensual_usd ?? 0)
  const diasRestantes = cliente.fecha_expiracion
    ? Math.ceil((new Date(cliente.fecha_expiracion).getTime() - Date.now()) / 86_400_000)
    : null

  const accesos: AccesoRapido[] = activos
    .filter(c => ACCESOS[c])
    .map(c => ({ clave: c, label: ACCESOS[c].label, ruta: ACCESOS[c].ruta }))

  return {
    nombreEmpresa: cliente.nombre_empresa,
    fecha: hoy,
    etiquetas,
    suscripcion: {
      estado: cliente.estado ?? '—',
      diasRestantes,
      label: suscripcionLabel(precioMes, cliente.ciclo_facturacion ?? 'mensual', descuento),
    },
    contabilidad, inventario, rrhh, reservas, citas, accesos,
  }
}
