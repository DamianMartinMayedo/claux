import { redirect }          from 'next/navigation'
import { getPortalSession }   from '@/app/actions/portal/auth'
import { obtenerFacturacion } from '@/app/actions/portal/facturacion'
import FacturacionView        from './FacturacionView'

export const dynamic = 'force-dynamic'

export default async function FacturacionPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const data = await obtenerFacturacion()
  if (!data) redirect('/portal/login')

  return <FacturacionView data={data} />
}
