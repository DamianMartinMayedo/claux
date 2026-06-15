import { obtenerDashboard } from '@/app/actions/portal/dashboard'
import DashboardView from './DashboardView'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const data = await obtenerDashboard()
  if (!data) return null

  // FASE 2: const session = await getPortalSession()
  // FASE 2: const modulosActivos = session ? [...cliente.modulos_activos] : []

  return <DashboardView data={data} />
}
