import { notFound, redirect } from 'next/navigation'
import {
  obtenerFacturaDetalle,
  obtenerContextoDocumento,
} from '@/app/actions/portal/ventas'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import EditarFacturaPage   from './EditarFacturaPage'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ factura_id: string }>
}

export default async function Page({ params }: PageProps) {
  // Editar es escritura: quien solo consulta vuelve a la ficha (solo lectura), no al
  // formulario. El candado real de servidor ya vive en las acciones de guardado.
  const { puedeEditar } = await requireAccesoModulo('base')
  const { factura_id } = await params
  if (!puedeEditar) redirect(`/portal/ventas/facturas/${factura_id}`)
  const [detalle, contexto] = await Promise.all([
    obtenerFacturaDetalle(factura_id),
    obtenerContextoDocumento(),
  ])
  if (!detalle || !contexto) notFound()
  return <EditarFacturaPage data={detalle} contexto={contexto} />
}
