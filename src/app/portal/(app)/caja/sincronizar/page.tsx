import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { listarCajas }    from '@/app/actions/portal/caja'
import SincronizarView    from './SincronizarView'

export const dynamic = 'force-dynamic'

export default async function SincronizarPage() {
  const { puedeEditar } = await requireAccesoModulo('caja')
  const cajas = await listarCajas()
  return <SincronizarView cajas={cajas.map(c => ({ caja_id: c.caja_id, nombre: c.nombre }))} puedeEditar={puedeEditar} />
}
