import { requireAccesoPagina } from '@/lib/admin-guard'
import { listarDiagnosticos } from '@/app/actions/diagnostico'
import SolicitudesView from './SolicitudesView'

export const dynamic = 'force-dynamic'

export default async function SolicitudesPage() {
  const ctx = await requireAccesoPagina('solicitudes')
  const leads = await listarDiagnosticos()
  return <SolicitudesView leads={leads} rol={ctx.rol} permisos={ctx.permisos} />
}
