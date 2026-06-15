import { notFound }         from 'next/navigation'
import { obtenerTesoreria } from '@/app/actions/portal/tesoreria'
import TesoreriaView        from './TesoreriaView'

export const dynamic = 'force-dynamic'

export default async function TesoreriaPage() {
  const data = await obtenerTesoreria()
  if (!data) notFound()
  return <TesoreriaView data={data} />
}
