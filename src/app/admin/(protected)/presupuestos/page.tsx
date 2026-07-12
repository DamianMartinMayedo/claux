import { requireAccesoPagina } from '@/lib/admin-guard'
import { listarPresupuestos } from '@/app/actions/presupuestos'
import PresupuestosView from './PresupuestosView'

export const dynamic = 'force-dynamic'

export default async function PresupuestosPage() {
  const ctx = await requireAccesoPagina('presupuestos')
  const presupuestos = await listarPresupuestos()
  return <PresupuestosView presupuestos={presupuestos} rol={ctx.rol} permisos={ctx.permisos} />
}
