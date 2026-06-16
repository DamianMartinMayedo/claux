import { AlertTriangle, CheckCircle, Clock, CreditCard, PauseCircle, Star, TrendingUp, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSetting }   from '@/app/actions/settings'
import ProximosVencer   from './ProximosVencer'

export default async function DashboardPage() {
  const supabase = await createClient()

  const DIAS_AVISO = parseInt(await getSetting('dias_aviso', '5'), 10)

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const fechaAviso = new Date(hoy)
  fechaAviso.setDate(hoy.getDate() + DIAS_AVISO)
  const fecha14 = new Date(hoy)
  fecha14.setDate(hoy.getDate() + 14)

  const fechaHoyStr   = hoy.toISOString().split('T')[0]
  const fechaAvisoStr = fechaAviso.toISOString().split('T')[0]
  const fecha14Str    = fecha14.toISOString().split('T')[0]

  const [
    { count: totalClientes },
    { count: clientesActivos },
    { count: enTrial },
    { count: totalModulos },
    { count: proximosVencer },
    { count: suspendidos },
    { data: clientesActivosDatos },
    { data: pagosData },
    { data: vencenProntoData },
    { data: trialGraciaData },
  ] = await Promise.all([
    supabase.from('clients').select('*', { count: 'exact', head: true }),
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('estado', 'ACTIVO'),
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('estado', 'TRIAL'),
    supabase.from('modulos_catalogo').select('*', { count: 'exact', head: true }).eq('activo', true),
    supabase.from('clients').select('*', { count: 'exact', head: true })
      .in('estado', ['ACTIVO', 'TRIAL'])
      .gte('fecha_expiracion', fechaHoyStr)
      .lte('fecha_expiracion', fechaAvisoStr),
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('estado', 'DESACTIVADO'),
    supabase.from('clients').select('precio_mensual_usd').in('estado', ['ACTIVO', 'TRIAL']),
    supabase.from('payments').select('monto_usd, fecha, estado'),
    // Vencen pronto: activos/trial expiran en 0-14 días (rojo y ámbar)
    supabase.from('clients')
      .select('client_id, nombre_empresa, estado, fecha_expiracion, fecha_fin_gracia')
      .in('estado', ['ACTIVO', 'TRIAL'])
      .gte('fecha_expiracion', fechaHoyStr)
      .lte('fecha_expiracion', fecha14Str)
      .order('fecha_expiracion', { ascending: true }),
    // Trial / Gracia: en esos estados, ordenados por urgencia
    supabase.from('clients')
      .select('client_id, nombre_empresa, estado, fecha_expiracion, fecha_fin_gracia')
      .in('estado', ['TRIAL', 'GRACIA'])
      .order('fecha_expiracion', { ascending: true }),
  ])

  // Ingresos mensuales estimados (MRR): suma del precio mensual de activos + trial
  const ingresosEstimados = (clientesActivosDatos ?? []).reduce(
    (sum, c) => sum + Number(c.precio_mensual_usd ?? 0), 0
  )

  // Ingresos del mes actual
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  // Solo los pagos confirmados cuentan como ingreso
  const confirmadosData = (pagosData ?? []).filter(p => p.estado !== 'por_confirmar')
  const ingresosMes = confirmadosData
    .filter(p => p.fecha?.startsWith(mesActual))
    .reduce((sum, p) => sum + (p.monto_usd ?? 0), 0)
  const totalPagos = confirmadosData.length

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Resumen general del sistema CLAUX</p>
        </div>
      </div>

      {/* ── Fila 1: Total clientes · Activos · Suspendidos · Planes ── */}
      <div className="metrics-grid metrics-grid-4">
        <div className="metric-card">
          <div className="metric-icon metric-icon-primary">
            <Users size={20} />
          </div>
          <p className="metric-label">Total clientes</p>
          <p className="metric-value">{totalClientes ?? 0}</p>
          <p className="metric-sub">Registrados en el sistema</p>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon-success">
            <CheckCircle size={20} />
          </div>
          <p className="metric-label">Clientes activos</p>
          <p className="metric-value">{clientesActivos ?? 0}</p>
          <p className="metric-sub">Con suscripción vigente</p>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon-danger">
            <PauseCircle size={20} />
          </div>
          <p className="metric-label">Suspendidos</p>
          <p className="metric-value">{suspendidos ?? 0}</p>
          <p className="metric-sub">Con acceso bloqueado</p>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon-amber">
            <Star size={20} />
          </div>
          <p className="metric-label">Módulos activos</p>
          <p className="metric-value">{totalModulos ?? 0}</p>
          <p className="metric-sub">En el catálogo</p>
        </div>
      </div>

      {/* ── Fila 2: Próximos a vencer · Trial · Ingresos mes · Ingresos estimados ── */}
      <div className="metrics-grid metrics-grid-4">
        <div className="metric-card">
          <div className="metric-icon metric-icon-amber-warm">
            <AlertTriangle size={20} />
          </div>
          <p className="metric-label">Próximos a vencer</p>
          <p className="metric-value">{proximosVencer ?? 0}</p>
          <p className="metric-sub">En los próximos {DIAS_AVISO} días</p>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon-warning">
            <Clock size={20} />
          </div>
          <p className="metric-label">En periodo trial</p>
          <p className="metric-value">{enTrial ?? 0}</p>
          <p className="metric-sub">Pendientes de conversión</p>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon-teal">
            <CreditCard size={20} />
          </div>
          <p className="metric-label">Ingresos este mes</p>
          <p className="metric-value">${ingresosMes.toFixed(0)}</p>
          <p className="metric-sub">{totalPagos} pago{totalPagos !== 1 ? 's' : ''} registrado{totalPagos !== 1 ? 's' : ''}</p>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon-teal">
            <TrendingUp size={20} />
          </div>
          <p className="metric-label">Ingresos estimados</p>
          <p className="metric-value">${ingresosEstimados.toFixed(0)}</p>
          <p className="metric-sub">Base de clientes activos + trial</p>
        </div>
      </div>

      {/* ── Fila 3: Bento alineado bajo Próximos a vencer + Trial ── */}
      <div className="dashboard-bento-bottom">
        <div className="dashboard-bento-cell">
          <ProximosVencer
            vencenPronto={vencenProntoData ?? []}
            trialGracia={trialGraciaData ?? []}
          />
        </div>
      </div>

    </div>
  )
}
