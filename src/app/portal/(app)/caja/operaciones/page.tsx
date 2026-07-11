import { requireModulo }      from '@/app/actions/portal/auth'
import { listarOperaciones }   from '@/app/actions/portal/caja'
import OperacionesView         from './OperacionesView'

export const dynamic = 'force-dynamic'

export default async function OperacionesPage() {
  await requireModulo('caja')
  const data = await listarOperaciones()
  return <OperacionesView data={data} />
}
