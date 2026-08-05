import { notFound }      from 'next/navigation'
import { requireModulo } from '@/app/actions/portal/auth'
import { obtenerTurnos } from '@/app/actions/portal/rrhh'
import TurnosView        from './TurnosView'

export const dynamic = 'force-dynamic'

export default async function TurnosPage() {
  await requireModulo('rrhh')
  const data = await obtenerTurnos()
  if (!data) notFound()
  return <TurnosView data={data} />
}
