import { redirect }          from 'next/navigation'
import { getPortalSession }   from '@/app/actions/portal/auth'
import { obtenerFacturacion } from '@/app/actions/portal/facturacion'
import FacturacionView        from './FacturacionView'

export const dynamic = 'force-dynamic'

export default async function FacturacionPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')
  // Facturación (plan, precio, estado y el historial de pagos del negocio) es cosa del
  // dueño: un `usuario` no-admin no debe verla ni por URL directa. El menú de cuenta ya
  // le oculta el acceso; esto es el candado real de servidor detrás.
  if (session.rol !== 'admin_empresa') redirect('/portal/dashboard')

  const data = await obtenerFacturacion()
  if (!data) redirect('/portal/login')

  return <FacturacionView data={data} />
}
