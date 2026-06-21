import { notFound }        from 'next/navigation'
import { requireModulo }   from '@/app/actions/portal/auth'
import { obtenerReservas } from '@/app/actions/portal/reservas'
import ReservasView        from './ReservasView'

export const dynamic = 'force-dynamic'

export default async function ReservasPage() {
  await requireModulo('reservas_citas')
  const data = await obtenerReservas()
  if (!data) notFound()
  return <ReservasView data={data} />
}
