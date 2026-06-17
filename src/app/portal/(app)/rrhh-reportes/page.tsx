import { notFound }      from 'next/navigation'
import { requireModulo } from '@/app/actions/portal/auth'
import { obtenerRrhh }   from '@/app/actions/portal/rrhh'
import ReportesView      from './ReportesView'

export const dynamic = 'force-dynamic'

export default async function ReportesRrhhPage() {
  await requireModulo('rrhh')
  const data = await obtenerRrhh()
  if (!data) notFound()
  return <ReportesView data={data} />
}
