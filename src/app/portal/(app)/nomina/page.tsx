import { notFound }      from 'next/navigation'
import { requireModulo } from '@/app/actions/portal/auth'
import { obtenerRrhh }   from '@/app/actions/portal/rrhh'
import NominaView        from './NominaView'

export const dynamic = 'force-dynamic'

export default async function NominaPage() {
  await requireModulo('rrhh')
  const data = await obtenerRrhh()
  if (!data) notFound()
  return <NominaView data={data} />
}
