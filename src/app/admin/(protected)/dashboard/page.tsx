import { requireAccesoPagina } from '@/lib/admin-guard'
import { AlertTriangle, CheckCircle, Clock, CreditCard, PauseCircle, Star, TrendingUp, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSetting }   from '@/app/actions/settings'
import {
  precioMensualEfectivo, monedaDelCliente, esSocioHoy,
  COLUMNAS_CONDICIONES, type CondicionesCliente,
} from '@/lib/billing'
import { totalPorMoneda, importesPorMoneda } from '@/lib/moneda-claux'
import { COLUMNAS_EXENCION } from '@/lib/clientes/ciclo-vida'
import ProximosVencer   from './ProximosVencer'

export default async function DashboardPage() {
  await requireAccesoPagina('dashboard')
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
    { data: proximosVencerData },
    { count: suspendidos },
    { data: clientesActivosDatos },
    { data: pagosData },
    { data: vencenProntoData },
    { data: trialGraciaData },
    { data: clientesPruebaData },
  ] = await Promise.all([
    // Los clientes de prueba (es_prueba) NO cuentan en las estadísticas de CLAUX.
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('es_prueba', false),
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('estado', 'ACTIVO').eq('es_prueba', false),
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('estado', 'TRIAL').eq('es_prueba', false),
    supabase.from('modulos_catalogo').select('*', { count: 'exact', head: true }).eq('activo', true),
    // Trae las filas en vez de contarlas: el socio hay que descartarlo con la misma
    // función que el resto de la pantalla, y una regla escrita a la vez en SQL y en
    // TypeScript es una regla que se separa. Son las que vencen en pocos días, no
    // la cartera entera.
    supabase.from('clients').select(COLUMNAS_EXENCION)
      .in('estado', ['ACTIVO', 'TRIAL'])
      .eq('es_prueba', false)
      .gte('fecha_expiracion', fechaHoyStr)
      .lte('fecha_expiracion', fechaAvisoStr),
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('estado', 'DESACTIVADO').eq('es_prueba', false),
    supabase.from('clients').select(COLUMNAS_CONDICIONES).in('estado', ['ACTIVO', 'TRIAL']).eq('es_prueba', false),
    supabase.from('payments').select('monto, moneda, fecha, estado, client_id'),
    // Vencen pronto: activos/trial expiran en 0-14 días (rojo y ámbar)
    supabase.from('clients')
      .select(`client_id, nombre_empresa, estado, fecha_expiracion, fecha_fin_gracia, ${COLUMNAS_EXENCION}`)
      .in('estado', ['ACTIVO', 'TRIAL'])
      .eq('es_prueba', false)
      .gte('fecha_expiracion', fechaHoyStr)
      .lte('fecha_expiracion', fecha14Str)
      .order('fecha_expiracion', { ascending: true }),
    // Trial / Gracia: en esos estados, ordenados por urgencia
    supabase.from('clients')
      .select(`client_id, nombre_empresa, estado, fecha_expiracion, fecha_fin_gracia, ${COLUMNAS_EXENCION}`)
      .in('estado', ['TRIAL', 'GRACIA'])
      .eq('es_prueba', false)
      .order('fecha_expiracion', { ascending: true }),
    // IDs de clientes de prueba: para excluir sus pagos de los ingresos.
    supabase.from('clients').select('client_id').eq('es_prueba', true),
  ])

  const idsPrueba = new Set((clientesPruebaData ?? []).map(c => c.client_id))
  // Un Socio CLAUX en GRACIA no es una urgencia: no debe nada, y su fecha de
  // gracia se queda atrás para siempre porque el barrido ya no lo toca. Sin este
  // filtro se quedaría clavado en rojo —«Vencido»— en la lista de lo que hay que
  // atender, que es la manera más rápida de que la lista deje de mirarse.
  const trialGracia = (trialGraciaData ?? []).filter(c => !esSocioHoy(c))
  // Y por lo mismo, fuera de «Vencen pronto»: al socio se le sigue calculando la
  // fecha de su ciclo, así que a la vuelta de un mes de haberlo marcado entra solo
  // en la ventana de 14 días y aparece como cobro urgente. Este filtro estaba en
  // la lista de al lado pero no en esta, en la misma pantalla.
  const vencenPronto   = (vencenProntoData ?? []).filter(c => !esSocioHoy(c))
  const proximosVencer = (proximosVencerData ?? []).filter(c => !esSocioHoy(c)).length

  // MRR: suma de la cuota EFECTIVA de activos + trial. Con el precio de catálogo el MRR
  // contaba dinero que nadie ingresa —un Socio CLAUX no paga y un descuento pactado no se
  // cobra—, y esa cifra es la que se mira para decidir.
  // Y separado por moneda, nunca convertido: el MRR en euros y el MRR en dólares
  // son dos cifras. Convertirlas para enseñar una sola las ata a la tasa del día,
  // que es justo de lo que este trabajo saca a CLAUX (mig. 225).
  // El cast es por la lista de columnas: al venir de una constante compartida (y no
  // escrita a mano aquí), PostgREST no puede tipar la respuesta. Mismo apaño que en
  // `listarPresupuestos`; a cambio, la lista de columnas no se desincroniza.
  const cartera = (clientesActivosDatos ?? []) as unknown as CondicionesCliente[]
  const ingresosEstimados = totalPorMoneda(cartera, monedaDelCliente, precioMensualEfectivo)

  // Ingresos del mes actual
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  // Solo los pagos confirmados cuentan como ingreso, y nunca los de clientes de prueba.
  const confirmadosData = (pagosData ?? [])
    .filter(p => p.estado !== 'por_confirmar' && !idsPrueba.has(p.client_id))
  // Cada cobro trae SU moneda: se agrupa por ella, no por la del cliente hoy.
  const ingresosMes = totalPorMoneda(
    confirmadosData.filter(p => p.fecha?.startsWith(mesActual)),
    p => p.moneda, p => p.monto,
  )
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
          <div className="metric-icon metric-icon-indigo">
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
          <div className="metric-icon metric-icon-amber">
            <AlertTriangle size={20} />
          </div>
          <p className="metric-label">Próximos a vencer</p>
          <p className="metric-value">{proximosVencer ?? 0}</p>
          <p className="metric-sub">En los próximos {DIAS_AVISO} días</p>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon-purple">
            <Clock size={20} />
          </div>
          <p className="metric-label">En periodo trial</p>
          <p className="metric-value">{enTrial ?? 0}</p>
          <p className="metric-sub">Pendientes de conversión</p>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon-primary">
            <CreditCard size={20} />
          </div>
          <p className="metric-label">Ingresos este mes</p>
          <p className="metric-value">{importesPorMoneda(ingresosMes, 'USD', 0)}</p>
          <p className="metric-sub">{totalPagos} pago{totalPagos !== 1 ? 's' : ''} registrado{totalPagos !== 1 ? 's' : ''}</p>
        </div>

        <div className="metric-card">
          <div className="metric-icon metric-icon-primary">
            <TrendingUp size={20} />
          </div>
          <p className="metric-label">Ingresos estimados</p>
          <p className="metric-value">{importesPorMoneda(ingresosEstimados, 'USD', 0)}</p>
          <p className="metric-sub">Base de clientes activos + trial</p>
        </div>
      </div>

      {/* ── Fila 3: Bento alineado bajo Próximos a vencer + Trial ── */}
      <div className="dashboard-bento-bottom">
        <div className="dashboard-bento-cell">
          <ProximosVencer
            vencenPronto={vencenPronto}
            trialGracia={trialGracia}
          />
        </div>
      </div>

    </div>
  )
}
