import { createClient } from '@/lib/supabase/server'
import RegistrarPagoModal from './RegistrarPagoModal'
import PagosTabla         from './PagosTabla'

export default async function PagosPage() {
  const supabase = await createClient()

  const [{ data: pagos }, { data: clientes }, { data: planes }] = await Promise.all([
    supabase.from('payments').select('*').order('fecha_fin_periodo', { ascending: false }),
    supabase.from('clients').select('client_id, nombre_empresa, plan_id').order('nombre_empresa'),
    supabase.from('plans').select('plan_id, nombre, precio_usd, duracion_dias').eq('estado', 'ACTIVO').order('precio_usd'),
  ])

  const clienteNombre = Object.fromEntries((clientes ?? []).map(c => [c.client_id, c.nombre_empresa]))
  const planNombre    = Object.fromEntries((planes    ?? []).map(p => [p.plan_id,   p.nombre]))

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pagos</h1>
          <p className="page-subtitle">
            {pagos?.length ?? 0} pago{pagos?.length !== 1 ? 's' : ''} registrado{pagos?.length !== 1 ? 's' : ''}
          </p>
        </div>
        <RegistrarPagoModal clientes={clientes ?? []} planes={planes ?? []} />
      </div>

      {!pagos || pagos.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="5" width="20" height="14" rx="2"/>
              <line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
            <h3 className="table-empty-title">Sin pagos registrados</h3>
            <p>Registra el primer pago con el botón de arriba.</p>
          </div>
        </div>
      ) : (
        <PagosTabla
          pagos={pagos}
          clienteNombre={clienteNombre}
          planNombre={planNombre}
          planesOpciones={planes ?? []}
        />
      )}
    </div>
  )
}
