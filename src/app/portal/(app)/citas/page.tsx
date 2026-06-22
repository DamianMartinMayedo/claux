import { notFound }      from 'next/navigation'
import { requireModulo } from '@/app/actions/portal/auth'
import { obtenerCitasData } from '@/app/actions/portal/citas'
import CitasView          from './CitasView'

export const dynamic = 'force-dynamic'

export default async function CitasPage() {
  await requireModulo('agenda')
  const data = await obtenerCitasData()
  if (!data) notFound()
  return <CitasView data={data} />
}
