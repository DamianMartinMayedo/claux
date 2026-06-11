import { notFound }             from 'next/navigation'
import {
  obtenerFacturaDetalle,
  obtenerVentasResumen,
} from '@/app/actions/portal/ventas'
import { obtenerEmpresas }      from '@/app/actions/portal/empresas'
import EditarFacturaPage         from './EditarFacturaPage'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ factura_id: string }>
}

export default async function Page({ params }: PageProps) {
  const { factura_id } = await params
  const [detalle, resumen, empresasFull] = await Promise.all([
    obtenerFacturaDetalle(factura_id),
    obtenerVentasResumen(),
    obtenerEmpresas(),
  ])
  if (!detalle || !resumen) notFound()
  return <EditarFacturaPage data={detalle} resumen={resumen} empresasFull={empresasFull} />
}
