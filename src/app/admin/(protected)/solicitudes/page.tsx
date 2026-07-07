import { listarDiagnosticos } from '@/app/actions/diagnostico'
import SolicitudesView from './SolicitudesView'

export const dynamic = 'force-dynamic'

export default async function SolicitudesPage() {
  const leads = await listarDiagnosticos()
  return <SolicitudesView leads={leads} />
}
