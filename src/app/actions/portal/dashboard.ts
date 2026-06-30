'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { obtenerEmpresasSelector } from './empresas'
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
  fecha: string; total: number; moneda: string; estado: string
}
// Ventas/gastos/neto del mes y serie de 6 meses, SEPARADOS por moneda: distintas
// monedas no se pueden sumar en un único número (cada empresa opera en la suya).
export interface ContabMonedaResumen {
  moneda: string
  ventasMes: number; gastosMes: number; netoMes: number
  serie: SerieMes[]
}
export interface ContabilidadResumen {
  porMoneda: ContabMonedaResumen[]
  consolidado: ContabMonedaResumen | null   // ventas/gastos convertidos a la moneda de consolidación
  monedaConsolidacion: string               // código de la moneda de consolidación (es_consolidacion)
  caja: { moneda: string; saldo: number }[]
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

export interface EmpresaLite { empresa_id: string; nombre: string; color?: string | null }

export interface DashboardData {
  nombreEmpresa: string
  empresas: EmpresaLite[]
  fecha: string
  etiquetas: EtiquetasSector
  suscripcion: { estado: string; diasRestantes: number | null; label: string }
  tieneIa: boolean
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

  const [facturas6, gastos6, movimientos, ultimas, consolRow, tasas] = await Promise.all([
    db.from('facturas').select('fecha_emision, total, moneda')
      .eq('client_id', cid).in('estado', ['EMITIDA', 'COBRADA']).gte('fecha_emision', desde6),
    db.from('gastos_cobros').select('fecha, monto, moneda')
      .eq('client_id', cid).eq('tipo', 'GASTO').gte('fecha', desde6),
    db.from('movimientos_tesoreria').select('monto, tipo, moneda').eq('client_id', cid),
    db.from('facturas').select('factura_id, numero, cliente_id, fecha_emision, total, moneda, estado')
      .eq('client_id', cid).order('fecha_emision', { ascending: false }).limit(5),
    db.from('monedas').select('codigo').eq('client_id', cid).eq('es_consolidacion', true).limit(1).maybeSingle(),
    db.from('tasas_cambio').select('moneda_origen, moneda_destino, tasa, fecha')
      .eq('client_id', cid).order('fecha', { ascending: false }),
  ])

  // Serie mensual y totales del mes SEPARADOS POR MONEDA (no se suman entre sí).
  const monedasSet = new Set<string>()
  for (const f of (facturas6.data ?? [])) monedasSet.add(f.moneda)
  for (const g of (gastos6.data ?? [])) monedasSet.add(g.moneda)

  const porMoneda: ContabMonedaResumen[] = [...monedasSet].sort().map(moneda => {
    const serieMap = new Map(meses.map(m => [m.mes, { ...m, ventas: 0, gastos: 0 }]))
    for (const f of (facturas6.data ?? [])) {
      if (f.moneda !== moneda) continue
      const b = serieMap.get(String(f.fecha_emision).slice(0, 7)); if (b) b.ventas += Number(f.total) || 0
    }
    for (const g of (gastos6.data ?? [])) {
      if (g.moneda !== moneda) continue
      const b = serieMap.get(String(g.fecha).slice(0, 7)); if (b) b.gastos += Number(g.monto) || 0
    }
    const bucket = serieMap.get(mesActual)
    const ventasMes = bucket?.ventas ?? 0
    const gastosMes = bucket?.gastos ?? 0
    return { moneda, ventasMes, gastosMes, netoMes: ventasMes - gastosMes, serie: [...serieMap.values()] }
  })

  // Consolidado: convierte cada moneda a la de consolidación (es_consolidacion).
  // Se ancla en los pares "consol→moneda" (p. ej. 1 USD = 670 CUP), que son los
  // consistentes; el factor es su inverso. Si falta tasa, esa moneda se excluye.
  const consolCode: string | null = consolRow.data?.codigo ?? null
  const rateMap = new Map<string, number>()
  for (const t of (tasas.data ?? [])) {
    const k = `${t.moneda_origen}__${t.moneda_destino}`
    if (!rateMap.has(k)) rateMap.set(k, Number(t.tasa)) // primera = más reciente (orden desc por fecha)
  }
  const factorAConsol = (moneda: string): number | null => {
    if (!consolCode) return null
    if (moneda === consolCode) return 1
    const saliente = rateMap.get(`${consolCode}__${moneda}`) // 1 consol = X moneda
    if (saliente && saliente > 0) return 1 / saliente
    const entrante = rateMap.get(`${moneda}__${consolCode}`) // 1 moneda = X consol
    if (entrante && entrante > 0) return entrante
    return null
  }
  const r2 = (n: number) => Math.round(n * 100) / 100

  let consolidado: ContabMonedaResumen | null = null
  if (consolCode && porMoneda.length > 1) {
    const convertibles = porMoneda
      .map(pm => ({ pm, f: factorAConsol(pm.moneda) }))
      .filter((x): x is { pm: ContabMonedaResumen; f: number } => x.f != null)
    if (convertibles.length) {
      const serie = meses.map((mm, i) => {
        let ventas = 0, gastos = 0
        for (const { pm, f } of convertibles) {
          ventas += (pm.serie[i]?.ventas ?? 0) * f
          gastos += (pm.serie[i]?.gastos ?? 0) * f
        }
        return { mes: mm.mes, etiqueta: mm.etiqueta, ventas: r2(ventas), gastos: r2(gastos) }
      })
      let ventasMes = 0, gastosMes = 0
      for (const { pm, f } of convertibles) { ventasMes += pm.ventasMes * f; gastosMes += pm.gastosMes * f }
      consolidado = { moneda: consolCode, ventasMes: r2(ventasMes), gastosMes: r2(gastosMes), netoMes: r2(ventasMes - gastosMes), serie }
    }
  }

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
    porMoneda, consolidado, monedaConsolidacion: consolCode ?? '', caja,
    ultimasFacturas: (ultimas.data ?? []).map((f: Record<string, unknown>) => ({
      factura_id: f.factura_id as string,
      numero: f.numero as string,
      cliente_nombre: nombres[f.cliente_id as string] ?? '—',
      fecha: f.fecha_emision as string,
      total: Number(f.total),
      moneda: f.moneda as string,
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

  const [contabilidad, inventario, rrhh, reservas, citas, etiquetas, descuentoRaw, empresas] = await Promise.all([
    tiene('base')           ? resumenContabilidad(db, cid, hoy)            : Promise.resolve(undefined),
    tiene('inventario')     ? resumenInventario(db, cid)                   : Promise.resolve(undefined),
    tiene('rrhh')           ? resumenRrhh(db, cid, hoy)                    : Promise.resolve(undefined),
    tiene('reservas_citas') ? resumenAgenda(db, cid, hoy, 'reserva')       : Promise.resolve(undefined),
    tiene('agenda')         ? resumenAgenda(db, cid, hoy, 'cita')          : Promise.resolve(undefined),
    obtenerEtiquetasNegocio(),
    getSetting('descuento_anual_pct', '10'),
    obtenerEmpresasSelector(),
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
    empresas: empresas.map(({ empresa_id, nombre, color }) => ({ empresa_id, nombre, color })),
    fecha: hoy,
    etiquetas,
    suscripcion: {
      estado: cliente.estado ?? '—',
      diasRestantes,
      label: suscripcionLabel(precioMes, cliente.ciclo_facturacion ?? 'mensual', descuento),
    },
    tieneIa: tiene('asistente_ia'),
    contabilidad, inventario, rrhh, reservas, citas, accesos,
  }
}
