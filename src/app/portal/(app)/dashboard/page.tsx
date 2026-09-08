import { obtenerDashboard } from '@/app/actions/portal/dashboard'
import DashboardView from './DashboardView'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  // El dashboard vive dentro del shell (layout) que ya exigió sesión; si por lo que
  // sea no la hay, la query devuelve null y no se pinta nada.
  //
  // El importador ya no se consulta aquí: su aviso de bienvenida es ahora un paso
  // del bloque de puesta en marcha, y la regla de acceso (`accesoImportCliente`)
  // se evalúa dentro de `calcularOnboarding`, junto al resto de los pasos — y solo
  // cuando ese bloque puede verse.
  const data = await obtenerDashboard()
  if (!data) return null

  return <DashboardView data={data} />
}
