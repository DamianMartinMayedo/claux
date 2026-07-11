import { requireModulo } from '@/app/actions/portal/auth'
import { listarCierres }  from '@/app/actions/portal/caja'
import CierresView        from './CierresView'

export const dynamic = 'force-dynamic'

export default async function CierresPage() {
  await requireModulo('caja')
  const data = await listarCierres()
  return <CierresView data={data} />
}
