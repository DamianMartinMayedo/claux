import { notFound }          from 'next/navigation'
import { requireModulo }     from '@/app/actions/portal/auth'
import { obtenerAlmacenes }  from '@/app/actions/portal/almacenes'
import AlmacenesView         from './AlmacenesView'

export const dynamic = 'force-dynamic'

export default async function AlmacenesPage() {
  await requireModulo('inventario')
  const data = await obtenerAlmacenes()
  if (!data) notFound()
  return <AlmacenesView data={data} />
}
