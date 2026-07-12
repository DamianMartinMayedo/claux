import { requireAccesoPagina } from '@/lib/admin-guard'
import { Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/app/actions/settings'
import NuevoClienteModal from './NuevoClienteModal'
import ClientesTabla     from './ClientesTabla'

export default async function ClientesPage() {
  await requireAccesoPagina('clientes')
  const supabase = await createClient()

  const [{ data: clientes }, { data: catalogo }, { data: plantillas }] = await Promise.all([
    supabase.from('clients').select('*').order('created_at', { ascending: false }),
    supabase
      .from('modulos_catalogo')
      .select('clave, nombre, descripcion, precio_fundador_usd, precio_estandar_usd, es_base, tipo')
      .eq('activo', true)
      .order('orden'),
    supabase
      .from('plantillas_sector')
      .select('sector, nombre, modulos, etiquetas')
      .eq('activa', true)
      .order('orden'),
  ])

  const setupDefault = parseFloat(await getSetting('pago_setup_usd_default', '1000')) || 0
  const descuentoAnual = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
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
        <NuevoClienteModal
          catalogo={catalogo ?? []}
          plantillas={plantillas ?? []}
          setupDefault={setupDefault}
          descuentoAnualPct={descuentoAnual}
        />
      </div>

      {!clientes || clientes.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <Users size={40} strokeWidth={1.5} />
            <h3 className="table-empty-title">Sin clientes registrados</h3>
            <p>Crea tu primer cliente con el botón de arriba.</p>
          </div>
        </div>
      ) : (
        <ClientesTabla clientes={clientes} descuentoAnualPct={descuentoAnual} />
      )}
    </div>
  )
}
