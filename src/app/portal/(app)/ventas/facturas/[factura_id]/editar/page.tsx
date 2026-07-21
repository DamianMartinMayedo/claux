import { notFound }             from 'next/navigation'
import {
  obtenerFacturaDetalle,
  obtenerVentasResumen,
} from '@/app/actions/portal/ventas'
import { requireModulo }        from '@/app/actions/portal/auth'
import EditarFacturaPage         from './EditarFacturaPage'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ factura_id: string }>
}

export default async function Page({ params }: PageProps) {
  await requireModulo('base')
  const { factura_id } = await params
  const [detalle, resumen] = await Promise.all([
    obtenerFacturaDetalle(factura_id),
    obtenerVentasResumen(),
  ])
  if (!detalle || !resumen) notFound()
  return <EditarFacturaPage data={detalle} resumen={resumen} />
}
