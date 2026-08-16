import { notFound, redirect }       from 'next/navigation'
import { requireAccesoModulo }      from '@/app/actions/portal/auth'
import { obtenerContextoDocumento } from '@/app/actions/portal/ventas'
import NuevaFacturaPage             from './NuevaFacturaPage'

export const dynamic = 'force-dynamic'

export default async function Page() {
  // Crear es escritura: quien solo consulta no tiene nada que hacer en esta ruta ni
  // por URL directa. El candado de servidor de las acciones ya lo pararía al guardar;
  // esto le ahorra el formulario entero.
  const { puedeEditar } = await requireAccesoModulo('base')
  if (!puedeEditar) redirect('/portal/ventas')
  const contexto = await obtenerContextoDocumento()
  if (!contexto) notFound()
  return <NuevaFacturaPage contexto={contexto} />
}
