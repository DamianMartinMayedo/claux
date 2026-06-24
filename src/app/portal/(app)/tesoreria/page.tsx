import { notFound }         from 'next/navigation'
import { requireModulo }     from '@/app/actions/portal/auth'
import { obtenerTesoreria } from '@/app/actions/portal/tesoreria'
import TesoreriaView        from './TesoreriaView'

export const dynamic = 'force-dynamic'

export default async function TesoreriaPage() {
  await requireModulo('base')
  const data = await obtenerTesoreria()
  if (!data) notFound()
  return <TesoreriaView data={data} />
}
