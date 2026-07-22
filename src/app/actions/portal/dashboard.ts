'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { ESTADOS_FACTURA_INGRESO } from '@/lib/contabilidad'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { modulosDeUsuario, calcularAcceso } from '@/lib/permisos'
import { leerSetting }       from '@/lib/settings'
import { suscripcionLabel }  from '@/lib/billing'
import { obtenerEtiquetasNegocio } from './sector'
import { hoyEnTz, ahoraEnTz, sumarDias } from '@/lib/fecha-tz'
import { estadoEfectivo, calcularCobroAcuerdo, type EstadoSub, type PeriodicidadSub, type DescuentoModo } from '@/lib/suscripciones'
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
export interface ServiciosResumen {
  activas: number
  ingresoRecurrente: { moneda: string; total: number }[]   // Σ precio_pactado normalizado a mensual, por moneda
  proximasRenovaciones: number                              // suscripciones cuyo próximo cobro cae en 30 días
}

export interface PuntoVentaResumen {
  ventasHoy:      { moneda: string; total: number }[]
  sinSincronizar: number
  puntos: {
    nombre:        string
    ventasHoy:     { moneda: string; total: number }[]
    ultimaSync:    string | null
    syncHoy:       boolean
    turnoAbiertoDesde: string | null   // fecha del turno abierto de un día anterior
  }[]
}
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

// Paso de puesta en marcha: dato base que el negocio debe crear para operar un
// módulo (empresa, moneda, almacén…). Nada se pre-crea, así que el dashboard guía
// los pasos fundamentales según los módulos contratados.
export interface OnboardingPaso { clave: string; label: string; hecho: boolean; href: string }

export interface DashboardData {
  nombreEmpresa: string
  empresas: EmpresaLite[]
  // Prerrequisitos base pendientes (solo admin_empresa, que es quien los crea;
  // ambos false para el resto). El dashboard muestra un aviso para crearlos sin
  // ocultar los widgets. `moneda` solo se marca si hay módulos que la usan.
  setupPendiente: { empresa: boolean; moneda: boolean }
  fecha: string
  etiquetas: EtiquetasSector
  suscripcion: { estado: string; diasRestantes: number | null; label: string }
  tieneIa: boolean
  contabilidad?: ContabilidadResumen
  inventario?: InventarioResumen
  puntoVenta?: PuntoVentaResumen
  rrhh?: RrhhResumen
  servicios?: ServiciosResumen
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

// `empresaIds` acota los datos a las empresas accesibles del usuario, igual que
// Ventas/Gastos/Tesorería/Reportes (`.in('empresa_id', …)`). Así el resumen del
// dashboard cuadra con lo que el usuario ve al abrir cada página.
async function resumenContabilidad(db: Db, cid: string, hoy: string, empresaIds: string[]): Promise<ContabilidadResumen> {
  const meses = clavesMes(hoy, 6)
  const desde6 = `${meses[0].mes}-01`
  const mesActual = hoy.slice(0, 7)

  const [facturas6, gastos6, movimientos, cuentasCaja, ultimas, consolRow, tasas] = await Promise.all([
    db.from('facturas').select('fecha_emision, total, moneda')
      .eq('client_id', cid).in('empresa_id', empresaIds).in('estado', ESTADOS_FACTURA_INGRESO).gte('fecha_emision', desde6),
    db.from('gastos_cobros').select('fecha, monto, moneda')
      .eq('client_id', cid).in('empresa_id', empresaIds).eq('tipo', 'GASTO').gte('fecha', desde6),
    db.from('movimientos_tesoreria').select('cuenta_id, monto, tipo').eq('client_id', cid).in('empresa_id', empresaIds),
    db.from('cuentas').select('cuenta_id, moneda, saldo_inicial').eq('client_id', cid).in('empresa_id', empresaIds).eq('activa', true).eq('es_apertura', false),
    db.from('facturas').select('factura_id, numero, cliente_id, fecha_emision, total, moneda, estado')
      .eq('client_id', cid).in('empresa_id', empresaIds).order('fecha_emision', { ascending: false }).limit(5),
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

  // Caja por moneda (igual que Tesorería: saldo_inicial de cuentas activas + Σ INGRESO − Σ EGRESO;
  // cuentas archivadas quedan fuera, junto con sus movimientos — y también las de
  // «Apertura» de la migración, que no son caja: el `continue` de abajo las descarta
  // porque no están en `cuentaMoneda`)
  const cuentaMoneda = new Map<string, string>()
  const cajaMap = new Map<string, number>()
  for (const c of (cuentasCaja.data ?? [])) {
    cuentaMoneda.set(c.cuenta_id, c.moneda)
    cajaMap.set(c.moneda, (cajaMap.get(c.moneda) ?? 0) + Number(c.saldo_inicial))
  }
  for (const m of (movimientos.data ?? [])) {
    const moneda = cuentaMoneda.get(m.cuenta_id)
    if (!moneda) continue
    const delta = m.tipo === 'INGRESO' ? Number(m.monto) : -Number(m.monto)
    cajaMap.set(moneda, (cajaMap.get(moneda) ?? 0) + (delta || 0))
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

// Resumen del Punto de venta. Sirve a los DOS tipos de cliente: al que tiene
// Contabilidad (para quien esto son sus ventas de mostrador, que además ya entran en
// el gráfico de Contabilidad vía los cierres) y al que solo tiene este módulo, para
// quien es su ÚNICO resumen de ventas en todo Claux.
//
// Sin gráfico a propósito: los datos llegan a golpes —cuando el dispositivo
// sincroniza, no cuando se vende—, así que una serie por días enseñaría huecos que
// parecen días sin ventas y no lo son.
async function resumenPuntoVenta(db: Db, cid: string, hoy: string, empresaIds: string[]): Promise<PuntoVentaResumen> {
  const [cajasRes, tksRes, sesRes] = await Promise.all([
    db.from('cajas').select('caja_id, nombre, last_sync_at')
      .eq('client_id', cid).eq('activa', true).order('nombre'),
    // Ventas de hoy: los ANULADO (rectificados) fuera, igual que en los cierres.
    db.from('caja_tickets').select('caja_id, moneda, total, estado')
      .eq('client_id', cid).in('empresa_id', empresaIds)
      .gte('fecha', `${hoy}T00:00:00`).lte('fecha', `${hoy}T23:59:59`),
    // Turnos abiertos: solo importan los de un día ANTERIOR. Uno abierto hoy es que
    // están vendiendo ahora; uno de ayer es que se olvidaron de cerrar, y sin cierre
    // no hay ingreso en Tesorería ni salida de stock — la contabilidad se queda quieta.
    db.from('caja_sesiones').select('caja_id, abierta_at')
      .eq('client_id', cid).eq('estado', 'ABIERTA').lt('abierta_at', `${hoy}T00:00:00`),
  ])

  const cajas = (cajasRes.data ?? []) as { caja_id: string; nombre: string; last_sync_at: string | null }[]
  const tickets = ((tksRes.data ?? []) as { caja_id: string; moneda: string; total: number; estado?: string }[])
    .filter(t => (t.estado ?? 'VIGENTE') !== 'ANULADO')
  const abiertas = new Map<string, string>()
  for (const s of ((sesRes.data ?? []) as { caja_id: string; abierta_at: string }[])) {
    if (!abiertas.has(s.caja_id)) abiertas.set(s.caja_id, s.abierta_at)
  }

  const sumar = (items: { moneda: string; total: number }[]) => {
    const acc = new Map<string, number>()
    for (const t of items) acc.set(t.moneda, (acc.get(t.moneda) ?? 0) + Number(t.total || 0))
    return [...acc].map(([moneda, total]) => ({ moneda, total })).sort((a, b) => b.total - a.total)
  }

  const puntos = cajas.map(c => {
    const suyos = tickets.filter(t => t.caja_id === c.caja_id)
    return {
      nombre:     c.nombre,
      ventasHoy:  sumar(suyos),
      ultimaSync: c.last_sync_at,
      syncHoy:    Boolean(c.last_sync_at && c.last_sync_at.slice(0, 10) === hoy),
      turnoAbiertoDesde: abiertas.get(c.caja_id) ?? null,
    }
  })

  return {
    ventasHoy:      sumar(tickets),
    sinSincronizar: puntos.filter(p => !p.syncHoy).length,
    puntos,
  }
}

async function resumenRrhh(db: Db, cid: string, hoy: string, empresaIds: string[]): Promise<RrhhResumen> {
  const inicioMes = `${hoy.slice(0, 7)}-01`
  const { data: empleados } = await db
    .from('empleados').select('fecha_alta, fecha_baja').eq('client_id', cid).in('empresa_id', empresaIds)

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

/* Checklist de onboarding EN PAUSA (no convence de momento). Para reactivarlo:
   volver a añadir la llamada al Promise.all del loader y descomentar la sección en
   DashboardView.tsx.
// Pasos fundamentales de puesta en marcha, según los módulos contratados. Cuenta
// solo lo que cada módulo necesita (evita queries de módulos no contratados). El
// paso "empresa" y la letra de facturación salen de `empresas` (ya cargadas), sin
// query extra. Los conteos usan head:true (baratos: no traen filas).
async function resumenOnboarding(
  db: Db, cid: string, modulos: string[],
  empresas: { estado: string; letra_facturacion?: string | null }[],
): Promise<OnboardingPaso[]> {
  const tiene = (m: string) => modulos.includes(m)
  const contar = async (tabla: string, filtrar: (q: Db) => Db): Promise<number> => {
    const { count } = await filtrar(db.from(tabla).select('*', { count: 'exact', head: true }).eq('client_id', cid))
    return count ?? 0
  }
  const necesitaMoneda = tiene('base') || tiene('rrhh') || tiene('catalogo_qr')

  const [monedas, almacenes, productos, franjas, servicios, recursos, catalogo] = await Promise.all([
    necesitaMoneda        ? contar('monedas', q => q.eq('activa', true)) : Promise.resolve(1),
    tiene('inventario')   ? contar('almacenes', q => q)                  : Promise.resolve(1),
    tiene('inventario')   ? contar('products', q => q)                   : Promise.resolve(1),
    tiene('reservas_citas') ? contar('reserva_franjas', q => q)          : Promise.resolve(1),
    tiene('agenda')       ? contar('servicios', q => q)                  : Promise.resolve(1),
    tiene('agenda')       ? contar('recursos', q => q)                   : Promise.resolve(1),
    tiene('catalogo_qr')  ? contar('catalogo_items', q => q)             : Promise.resolve(1),
  ])

  const pasos: OnboardingPaso[] = [
    { clave: 'empresa', label: 'Crea tu empresa', hecho: empresas.length > 0, href: '/portal/empresas' },
  ]
  if (necesitaMoneda)  pasos.push({ clave: 'moneda',   label: 'Configura una moneda',        hecho: monedas > 0,   href: '/portal/monedas' })
  if (tiene('base'))   pasos.push({ clave: 'letra',    label: 'Asigna letra de facturación', hecho: empresas.some(e => !!e.letra_facturacion), href: '/portal/empresas' })
  if (tiene('inventario')) {
    pasos.push({ clave: 'almacen',  label: 'Crea un almacén', hecho: almacenes > 0, href: '/portal/almacenes' })
    pasos.push({ clave: 'producto', label: 'Añade un producto', hecho: productos > 0, href: '/portal/productos' })
  }
  if (tiene('reservas_citas')) pasos.push({ clave: 'franja', label: 'Crea una franja de reservas', hecho: franjas > 0, href: '/portal/reservas' })
  if (tiene('agenda')) {
    pasos.push({ clave: 'servicio', label: 'Añade un servicio',    hecho: servicios > 0, href: '/portal/citas' })
    pasos.push({ clave: 'recurso',  label: 'Añade un profesional', hecho: recursos > 0,  href: '/portal/citas' })
  }
  if (tiene('catalogo_qr')) pasos.push({ clave: 'catalogo', label: 'Añade un ítem al catálogo', hecho: catalogo > 0, href: '/portal/catalogo' })
  return pasos
}
*/

async function resumenServicios(db: Db, cid: string, hoy: string): Promise<ServiciosResumen> {
  const [{ data }, { data: lins }] = await Promise.all([
    db.from('suscripciones')
      .select('suscripcion_id, moneda, periodicidad, fecha_proximo_cobro, estado, fecha_fin, renovacion_automatica')
      .eq('client_id', cid).eq('estado', 'ACTIVA'),
    db.from('suscripcion_lineas').select('suscripcion_id, precio_mensual, descuento_modo, descuento_valor').eq('client_id', cid),
  ])

  // Las líneas de cada acuerdo (mig. 124/125): el cobro suma el de cada servicio con su
  // propio descuento.
  const lineasPorSub = new Map<string, { precio_mensual: number; descuento_modo: DescuentoModo; descuento_valor: number }[]>()
  for (const l of (lins ?? []) as { suscripcion_id: string; precio_mensual: number | string; descuento_modo: string; descuento_valor: number | string }[]) {
    const arr = lineasPorSub.get(l.suscripcion_id) ?? []
    arr.push({
      precio_mensual:  Number(l.precio_mensual) || 0,
      descuento_modo:  (l.descuento_modo === 'MONTO_FIJO' ? 'MONTO_FIJO' : 'PORCENTAJE') as DescuentoModo,
      descuento_valor: Number(l.descuento_valor) || 0,
    })
    lineasPorSub.set(l.suscripcion_id, arr)
  }

  // «Vencida» no se guarda, se DERIVA (decisión 12): una de fin fijo que ya pasó sigue
  // en estado ACTIVA en la tabla. Sin derivar aquí, el listado la daba por vencida y el
  // widget la seguía sumando al ingreso recurrente — el mismo negocio con dos cifras
  // distintas, y la del dashboard inflada con dinero que ya no entra.
  const filas = ((data ?? []) as {
    suscripcion_id: string
    moneda: string; periodicidad: string
    fecha_proximo_cobro: string; estado: string; fecha_fin: string | null; renovacion_automatica: boolean
  }[]).filter(f => estadoEfectivo(
    { estado: f.estado as EstadoSub, fecha_fin: f.fecha_fin, renovacion_automatica: f.renovacion_automatica }, hoy,
  ) === 'ACTIVA')

  const [y, m, d] = hoy.split('-').map(Number)
  const en30 = new Date(Date.UTC(y, m - 1, d + 30)).toISOString().split('T')[0]

  const porMoneda = new Map<string, number>()
  let proximas = 0
  for (const f of filas) {
    // Con el descuento aplicado: un anual rebajado un 15 % no aporta el precio de
    // catálogo al ingreso recurrente, aporta lo que de verdad se cobra.
    const { equivalenteMensual } = calcularCobroAcuerdo(
      lineasPorSub.get(f.suscripcion_id) ?? [], f.periodicidad as PeriodicidadSub,
    )
    porMoneda.set(f.moneda, (porMoneda.get(f.moneda) ?? 0) + equivalenteMensual)
    if (f.fecha_proximo_cobro && f.fecha_proximo_cobro <= en30) proximas++
  }
  return {
    activas: filas.length,
    ingresoRecurrente: [...porMoneda.entries()].map(([moneda, total]) => ({ moneda, total: Math.round(total * 100) / 100 })),
    proximasRenovaciones: proximas,
  }
}

// ── Loader principal ─────────────────────────────────────────────────────────────

export async function obtenerDashboard(): Promise<DashboardData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const cid = session.client_id
  const hoy = hoyEnTz()

  // El dashboard muestra SOLO lo que este usuario puede ver, no lo que el tenant
  // tiene contratado: módulos por permiso efectivo (mismo cálculo que el sidebar,
  // `calcularAcceso`) y datos acotados a sus empresas (igual que cada página del
  // portal). Así cada widget coincide con lo que encuentra al abrir el módulo.
  const [{ data: cliente }, filasUsuario, empresasAcc] = await Promise.all([
    db.from('clients')
      .select('nombre_empresa, estado, modulos_activos, precio_mensual_usd, ciclo_facturacion, fecha_expiracion')
      .eq('client_id', cid).single(),
    modulosDeUsuario(db, session.user_id),
    obtenerEmpresas(),
  ])
  if (!cliente) return null

  const modulosActivos: string[] = Array.isArray(cliente.modulos_activos) ? cliente.modulos_activos : []
  const { visibles } = calcularAcceso(session, modulosActivos, filasUsuario)
  const puedeVer = (m: string) => visibles.includes(m)

  // Empresas accesibles del usuario. Contabilidad y RRHH acotan sus datos a estas
  // (como reportes.ts/gastos.ts/rrhh.ts); Inventario y Reservas/Citas quedan
  // client-wide, igual que productos.ts/reservas.ts. El '__none__' replica el guard
  // de las páginas: sin empresas asignadas no se filtra a "todo el cliente".
  const empresaIds    = empresasAcc.map(e => e.empresa_id)
  const idsFiltro     = empresaIds.length ? empresaIds : ['__none__']
  const empresasVista = empresasAcc.filter(e => e.estado === 'ACTIVO')

  const [contabilidad, inventario, puntoVenta, rrhh, reservas, citas, servicios, etiquetas, descuentoRaw] = await Promise.all([
    puedeVer('base')           ? resumenContabilidad(db, cid, hoy, idsFiltro) : Promise.resolve(undefined),
    puedeVer('inventario')     ? resumenInventario(db, cid)                   : Promise.resolve(undefined),
    puedeVer('caja')           ? resumenPuntoVenta(db, cid, hoy, idsFiltro)   : Promise.resolve(undefined),
    puedeVer('rrhh')           ? resumenRrhh(db, cid, hoy, idsFiltro)         : Promise.resolve(undefined),
    puedeVer('reservas_citas') ? resumenAgenda(db, cid, hoy, 'reserva')       : Promise.resolve(undefined),
    puedeVer('agenda')         ? resumenAgenda(db, cid, hoy, 'cita')          : Promise.resolve(undefined),
    puedeVer('servicios')      ? resumenServicios(db, cid, hoy)               : Promise.resolve(undefined),
    obtenerEtiquetasNegocio(),
    leerSetting('descuento_anual_pct', '10'),
  ])
  // Aviso de setup: datos base que solo el admin puede crear. Empresa siempre;
  // moneda solo si hay módulos que la usan (base/rrhh/catálogo/dossier). La query
  // de moneda se hace solo cuando aplica y para admin. (El checklist quedó en pausa.)
  let setupPendiente = { empresa: false, moneda: false }
  if (session.rol === 'admin_empresa') {
    const MODULOS_CON_MONEDA = ['base', 'rrhh', 'catalogo_qr', 'dossier']
    const necesitaMoneda = MODULOS_CON_MONEDA.some(m => modulosActivos.includes(m))
    let sinMoneda = false
    if (necesitaMoneda) {
      const { count } = await db.from('monedas')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', cid).eq('activa', true)
      sinMoneda = !count
    }
    setupPendiente = { empresa: empresasAcc.length === 0, moneda: sinMoneda }
  }

  const descuento = parseInt(descuentoRaw, 10) || 0
  const precioMes = Number(cliente.precio_mensual_usd ?? 0)
  const diasRestantes = cliente.fecha_expiracion
    ? Math.ceil((new Date(cliente.fecha_expiracion).getTime() - Date.now()) / 86_400_000)
    : null

  // La etiqueta del acceso respeta el vocabulario del sector (Menú/Carta en vez
  // de "Catálogo", "Citas" en vez de "Reservas"…). El resto mantiene su nombre.
  const labelAcceso = (c: string): string =>
    c === 'catalogo_qr'    ? etiquetas.catalogo
    : c === 'reservas_citas' ? etiquetas.reservas
    : ACCESOS[c].label
  const accesos: AccesoRapido[] = visibles
    .filter(c => ACCESOS[c])
    .map(c => ({ clave: c, label: labelAcceso(c), ruta: ACCESOS[c].ruta }))

  return {
    nombreEmpresa: cliente.nombre_empresa,
    empresas: empresasVista.map(({ empresa_id, nombre, color }) => ({ empresa_id, nombre, color })),
    setupPendiente,
    fecha: hoy,
    etiquetas,
    suscripcion: {
      estado: cliente.estado ?? '—',
      diasRestantes,
      label: suscripcionLabel(precioMes, cliente.ciclo_facturacion ?? 'mensual', descuento),
    },
    tieneIa: puedeVer('asistente_ia'),
    contabilidad, inventario, puntoVenta, rrhh, servicios, reservas, citas, accesos,
  }
}
