import { notFound }      from 'next/navigation'
import { requireModulo } from '@/app/actions/portal/auth'
import { obtenerRrhh }   from '@/app/actions/portal/rrhh'
import ContratosView     from './ContratosView'

export const dynamic = 'force-dynamic'

export default async function ContratosPage() {
  await requireModulo('rrhh')
  const data = await obtenerRrhh()
  if (!data) notFound()
  return <ContratosView data={data} />
}
