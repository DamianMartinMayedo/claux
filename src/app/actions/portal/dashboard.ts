'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { getSetting }        from '@/app/actions/settings'
import { suscripcionLabel }  from '@/lib/billing'
import { obtenerEmpresas }   from './empresas'

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface DashboardResumen {
  ventasMes:        { total_usd: number; cantidad: number }
  gastosMes:        { total_usd: number; cantidad: number }
  balance:          { moneda: string; saldo: number }[]
  suscripcion:      { estado: string; diasRestantes: number | null; label: string }
  ultimasFacturas:  { factura_id: string; numero: string; cliente_nombre: string; fecha: string; moneda: string; total: number; estado: string }[]
  empresas:         number
}

// ── Obtener datos del dashboard ───────────────────────────────────────────────

export async function obtenerDashboard(): Promise<DashboardResumen | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const client_id = session.client_id

  // Inicio del mes actual
  const ahora = new Date()
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString().split('T')[0]
  const hoy = ahora.toISOString().split('T')[0]

  // Paralelizar: facturas del mes, gastos del mes, últimos 5 facturas, empresas
  const [
    { data: facturasMes },
    { data: gastosMes },
    { data: ultimasFacturas },
    empresas,
    { data: cliente },
  ] = await Promise.all([
    db.from('facturas')
      .select('total, moneda')
      .eq('client_id', client_id)
      .eq('estado', 'CONFIRMADO')
      .gte('fecha_emision', inicioMes)
      .lte('fecha_emision', hoy),
    db.from('gastos_cobros')
      .select('monto')
      .eq('client_id', client_id)
      .eq('tipo', 'GASTO')
      .gte('fecha', inicioMes)
      .lte('fecha', hoy),
    db.from('facturas')
      .select('factura_id, numero, cliente_id, fecha_emision, moneda, total, estado')
      .eq('client_id', client_id)
      .order('fecha_emision', { ascending: false })
      .limit(5),
    obtenerEmpresas(),
    db.from('clients')
      .select('estado, precio_mensual_usd, ciclo_facturacion, fecha_expiracion')
      .eq('client_id', client_id)
      .single(),
  ])

  // Ventas del mes: sumar totales en la moneda que venga (asumimos USD como base)
  const totalVentas = (facturasMes ?? []).reduce((sum, f) => sum + (Number(f.total) || 0), 0)
  const cantidadVentas = (facturasMes ?? []).length

  // Gastos del mes
  const totalGastos = (gastosMes ?? []).reduce((sum, g) => sum + (Number(g.monto) || 0), 0)
  const cantidadGastos = (gastosMes ?? []).length

  // Nombres de clientes para las últimas facturas
  const clienteIds = [...new Set((ultimasFacturas ?? []).map(f => f.cliente_id))]
  const { data: terceros } = clienteIds.length > 0
    ? await db.from('third_parties').select('tercero_id, nombre').eq('client_id', client_id).in('tercero_id', clienteIds)
    : { data: [] }
  const nombreMap = Object.fromEntries((terceros ?? []).map(t => [t.tercero_id, t.nombre]))

  // Balance — query única agrupada por moneda
  const { data: movimientos } = await db.from('movimientos_tesoreria')
    .select('monto, tipo, moneda')
    .eq('client_id', client_id)
  const balanceMap = new Map<string, number>()
  for (const m of (movimientos ?? [])) {
    const prev = balanceMap.get(m.moneda) ?? 0
    const delta = m.tipo === 'ENTRADA' ? Number(m.monto) : -Number(m.monto)
    balanceMap.set(m.moneda, prev + delta)
  }
  const balance: { moneda: string; saldo: number }[] = []
  for (const [moneda, saldo] of balanceMap) {
    if (saldo !== 0) balance.push({ moneda, saldo })
  }

  // Suscripción
  const descuento = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const precioMes = Number(cliente?.precio_mensual_usd ?? 0)
  const suscripcionLabel_ = suscripcionLabel(precioMes, cliente?.ciclo_facturacion ?? 'mensual', descuento)
  const diasRestantes = cliente?.fecha_expiracion
    ? Math.ceil((new Date(cliente.fecha_expiracion).getTime() - Date.now()) / 86_400_000)
    : null

  return {
    ventasMes:     { total_usd: totalVentas, cantidad: cantidadVentas },
    gastosMes:     { total_usd: totalGastos, cantidad: cantidadGastos },
    balance,
    suscripcion:   { estado: cliente?.estado ?? '—', diasRestantes, label: suscripcionLabel_ },
    ultimasFacturas: (ultimasFacturas ?? []).map(f => ({
      factura_id:   f.factura_id,
      numero:       f.numero,
      cliente_nombre: nombreMap[f.cliente_id] ?? f.cliente_id,
      fecha:        f.fecha_emision,
      moneda:       f.moneda,
      total:        Number(f.total),
      estado:       f.estado,
    })),
    empresas:      (empresas ?? []).length,
  }
}
