import { notFound }            from 'next/navigation'
import { obtenerOfertaDetalle } from '@/app/actions/portal/ventas'
import { requireModulo }        from '@/app/actions/portal/auth'
import OfertaDetalle            from './OfertaDetalle'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ oferta_id: string }>
}

// Sin `obtenerVentasResumen`: la ficha no usaba nada de él (ver la nota en la ficha de
// factura). Abrir una oferta ya no descarga el histórico entero de ventas.
export default async function OfertaDetallePage({ params }: PageProps) {
  await requireModulo('base')
  const { oferta_id } = await params
  const detalle = await obtenerOfertaDetalle(oferta_id)
  if (!detalle) notFound()
  return <OfertaDetalle data={detalle} />
}
