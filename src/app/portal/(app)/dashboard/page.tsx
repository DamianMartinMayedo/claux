import { obtenerDashboard } from '@/app/actions/portal/dashboard'
import { getPortalSession } from '@/app/actions/portal/auth'
import { accesoImportCliente } from '@/lib/importador/acceso-cliente'
import DashboardView from './DashboardView'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await getPortalSession()
  // El dashboard vive dentro del shell (layout) que ya exigió sesión; si por lo que
  // sea no la hay, la query de abajo devuelve null y no se pinta nada.
  const [data, acceso] = await Promise.all([
    obtenerDashboard(),
    // Misma regla ÚNICA que el menú de cuenta y el guard de /portal/importar-datos.
    // `disponible` ya exige permiso ∩ módulo ∩ autoimport ∩ estado != a_cargo_equipo.
    session ? accesoImportCliente(session) : Promise.resolve(null),
  ])
  if (!data) return null

  // Aviso de bienvenida SOLO con migración `pendiente` (el único estado con aviso):
  // 'sin_datos_previos'/'completada' tienen la herramienta pero sin nudge, y
  // 'a_cargo_equipo' ni siquiera es `disponible`.
  const mostrarImportar = !!acceso && acceso.disponible && acceso.migracion_estado === 'pendiente'

  return <DashboardView data={data} mostrarImportar={mostrarImportar} />
}
