import { notFound }                from 'next/navigation'
import {
  obtenerFacturaDetalle,
  obtenerVentasResumen,
} from '@/app/actions/portal/ventas'
import { obtenerCobrosFactura } from '@/app/actions/portal/cobranza'
import FacturaDetalle from './FacturaDetalle'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ factura_id: string }>
}

export default async function FacturaDetallePage({ params }: PageProps) {
  const { factura_id } = await params
  const [detalle, resumen, cobros] = await Promise.all([
    obtenerFacturaDetalle(factura_id),
    obtenerVentasResumen(),
    obtenerCobrosFactura(factura_id),
  ])
  if (!detalle || !resumen) notFound()
  return <FacturaDetalle data={detalle} resumen={resumen} cobros={cobros} />
}
