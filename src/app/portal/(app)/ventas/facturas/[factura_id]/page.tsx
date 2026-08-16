import { notFound }             from 'next/navigation'
import { obtenerFacturaDetalle } from '@/app/actions/portal/ventas'
import { obtenerCobrosFactura }  from '@/app/actions/portal/cobranza'
import { requireAccesoModulo }   from '@/app/actions/portal/auth'
import FacturaDetalle            from './FacturaDetalle'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ factura_id: string }>
}

// La ficha NO pide `obtenerVentasResumen`: lo hacía y no usaba el resultado, así que
// abrir una factura descargaba todas las facturas y todas las ofertas del negocio.
export default async function FacturaDetallePage({ params }: PageProps) {
  const { puedeEditar } = await requireAccesoModulo('base')
  const { factura_id } = await params
  const [detalle, cobros] = await Promise.all([
    obtenerFacturaDetalle(factura_id),
    obtenerCobrosFactura(factura_id),
  ])
  if (!detalle) notFound()
  return <FacturaDetalle data={detalle} cobros={cobros} tienePermiso={puedeEditar} />
}
