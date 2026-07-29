import { notFound }        from 'next/navigation'
import {
  obtenerFacturaDetalle,
  obtenerContextoDocumento,
} from '@/app/actions/portal/ventas'
import { requireModulo }   from '@/app/actions/portal/auth'
import EditarFacturaPage   from './EditarFacturaPage'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ factura_id: string }>
}

export default async function Page({ params }: PageProps) {
  await requireModulo('base')
  const { factura_id } = await params
  const [detalle, contexto] = await Promise.all([
    obtenerFacturaDetalle(factura_id),
    obtenerContextoDocumento(),
  ])
  if (!detalle || !contexto) notFound()
  return <EditarFacturaPage data={detalle} contexto={contexto} />
}
