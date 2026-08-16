import { notFound, redirect } from 'next/navigation'
import {
  obtenerOfertaDetalle,
  obtenerContextoDocumento,
} from '@/app/actions/portal/ventas'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import EditarOfertaPage    from './EditarOfertaPage'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ oferta_id: string }>
}

export default async function Page({ params }: PageProps) {
  // Editar es escritura: quien solo consulta vuelve a la ficha (solo lectura), no al
  // formulario. El candado real de servidor ya vive en las acciones de guardado.
  const { puedeEditar } = await requireAccesoModulo('base')
  const { oferta_id } = await params
  if (!puedeEditar) redirect(`/portal/ventas/ofertas/${oferta_id}`)
  const [detalle, contexto] = await Promise.all([
    obtenerOfertaDetalle(oferta_id),
    obtenerContextoDocumento(),
  ])
  if (!detalle || !contexto) notFound()
  return <EditarOfertaPage data={detalle} contexto={contexto} />
}
