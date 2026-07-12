import { requireAccesoPagina } from '@/lib/admin-guard'
import { listarDiagnosticos } from '@/app/actions/diagnostico'
import VentasTabs from '@/components/admin/VentasTabs'
import SolicitudesView from './SolicitudesView'

export const dynamic = 'force-dynamic'

export default async function SolicitudesPage() {
  const ctx = await requireAccesoPagina('solicitudes')
  const leads = await listarDiagnosticos()
  return (
    <>
      <VentasTabs rol={ctx.rol} permisos={ctx.permisos} />
      <SolicitudesView leads={leads} />
    </>
  )
}
