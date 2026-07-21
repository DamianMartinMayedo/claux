import { redirect }             from 'next/navigation'
import { requireModulo }        from '@/app/actions/portal/auth'
import { obtenerSuscripciones } from '@/app/actions/portal/suscripciones'
import SuscripcionesView        from './SuscripcionesView'

export const dynamic = 'force-dynamic'

export default async function SuscripcionesPage() {
  await requireModulo('servicios')
  const data = await obtenerSuscripciones()
  if (!data) redirect('/portal/login')
  return <SuscripcionesView data={data} />
}
