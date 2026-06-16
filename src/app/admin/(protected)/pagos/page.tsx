import { CreditCard } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/app/actions/settings'
import RegistrarPagoModal from './RegistrarPagoModal'
import PagosTabla         from './PagosTabla'

export default async function PagosPage() {
  const supabase = await createClient()

  const [{ data: pagos }, { data: clientes }] = await Promise.all([
    supabase.from('payments').select('*').order('fecha', { ascending: false }),
    supabase.from('clients')
      .select('client_id, nombre_empresa, precio_mensual_usd, ciclo_facturacion')
      .order('nombre_empresa'),
  ])

  const descuentoAnual = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const clienteNombre = Object.fromEntries((clientes ?? []).map(c => [c.client_id, c.nombre_empresa]))

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pagos</h1>
          <p className="page-subtitle">
            {pagos?.length ?? 0} pago{pagos?.length !== 1 ? 's' : ''} registrado{pagos?.length !== 1 ? 's' : ''}
          </p>
        </div>
        <RegistrarPagoModal clientes={clientes ?? []} descuentoAnualPct={descuentoAnual} />
      </div>

      {!pagos || pagos.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <CreditCard size={40} strokeWidth={1.5} />
            <h3 className="table-empty-title">Sin pagos registrados</h3>
            <p>Registra el primer pago con el botón de arriba.</p>
          </div>
        </div>
      ) : (
        <PagosTabla
          pagos={pagos}
          clienteNombre={clienteNombre}
        />
      )}
    </div>
  )
}
