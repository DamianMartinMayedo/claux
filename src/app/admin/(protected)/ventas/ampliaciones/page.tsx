import { requireAccesoPagina } from '@/lib/admin-guard'
import { listarAmpliaciones } from '@/app/actions/soporte'
import AmpliacionesView from './AmpliacionesView'

export const dynamic = 'force-dynamic'

// Lo que un cliente ya nuestro pide activar desde el dashboard. Vive en Ventas
// porque es venta: hasta ahora solo llegaba a /admin/soporte, mezclado con las
// incidencias, y quien vende no tiene por qué entrar ahí.
export default async function AmpliacionesPage() {
  const ctx = await requireAccesoPagina('solicitudes')
  const solicitudes = await listarAmpliaciones()
  return <AmpliacionesView solicitudes={solicitudes} rol={ctx.rol} permisos={ctx.permisos} />
}
