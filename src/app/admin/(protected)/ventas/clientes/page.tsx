import { requireAccesoPagina } from '@/lib/admin-guard'
import { createClient } from '@/lib/supabase/server'
import { leerSetting } from '@/lib/settings'
import VentasTabs from '@/components/admin/VentasTabs'
import ClientesReadOnly from './ClientesReadOnly'

export const dynamic = 'force-dynamic'

export default async function VentasClientesPage() {
  const ctx = await requireAccesoPagina('clientes_ro')
  const supabase = await createClient()

  const { data: clientes } = await supabase
    .from('clients')
    .select('client_id, nombre_empresa, nombre_contacto, email_admin, estado, precio_mensual_usd, ciclo_facturacion')
    .order('created_at', { ascending: false })

  const descuentoAnual = parseInt(await leerSetting('descuento_anual_pct', '10'), 10) || 0

  return (
    <>
      <VentasTabs rol={ctx.rol} permisos={ctx.permisos} />
      <ClientesReadOnly clientes={clientes ?? []} descuentoAnualPct={descuentoAnual} />
    </>
  )
}
