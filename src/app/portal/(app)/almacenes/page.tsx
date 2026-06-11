import { notFound }          from 'next/navigation'
import { obtenerAlmacenes }  from '@/app/actions/portal/almacenes'
import AlmacenesView         from './AlmacenesView'

export const dynamic = 'force-dynamic'

export default async function AlmacenesPage() {
  const data = await obtenerAlmacenes()
  if (!data) notFound()
  return <AlmacenesView data={data} />
}
