import { notFound }       from 'next/navigation'
import { requireModulo }  from '@/app/actions/portal/auth'
import { obtenerRrhh }    from '@/app/actions/portal/rrhh'
import RrhhView           from './RrhhView'

export const dynamic = 'force-dynamic'

export default async function RrhhPage() {
  await requireModulo('rrhh')
  const data = await obtenerRrhh()
  if (!data) notFound()
  return <RrhhView data={data} />
}
