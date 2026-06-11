import { createClient } from '@/lib/supabase/server'
import NuevoClienteModal from './NuevoClienteModal'
import ClientesTabla     from './ClientesTabla'

export default async function ClientesPage() {
  const supabase = await createClient()

  const [{ data: clientes }, { data: planes }] = await Promise.all([
    supabase.from('clients').select('*').order('created_at', { ascending: false }),
    supabase.from('plans').select('plan_id, nombre, nivel, precio_usd').eq('estado', 'ACTIVO').order('precio_usd'),
  ])

  const planNombre = Object.fromEntries((planes ?? []).map(p => [p.plan_id, p.nombre]))
  const total = clientes?.length ?? 0

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">
            {total} cliente{total !== 1 ? 's' : ''} registrado{total !== 1 ? 's' : ''}
          </p>
        </div>
        <NuevoClienteModal planes={planes ?? []} />
      </div>

      {!clientes || clientes.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <h3 className="table-empty-title">Sin clientes registrados</h3>
            <p>Crea tu primer cliente con el botón de arriba.</p>
          </div>
        </div>
      ) : (
        <ClientesTabla
          clientes={clientes}
          planes={planes ?? []}
          planNombre={planNombre}
        />
      )}
    </div>
  )
}
