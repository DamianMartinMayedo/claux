import { notFound } from 'next/navigation'
import { requireModulo }          from '@/app/actions/portal/auth'
import { obtenerProductoDetalle } from '@/app/actions/portal/productos'
import ProductoDetalle            from '../../productos/[producto_id]/ProductoDetalle'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ servicio_id: string }>
}

export default async function ServicioDetallePage({ params }: Props) {
  await requireModulo('servicios')
  const { servicio_id } = await params
  const data = await obtenerProductoDetalle(servicio_id)
  // Debe ser un SERVICIO: los productos físicos viven en /portal/productos.
  if (data === null || data.producto.tipo !== 'SERVICIO') notFound()
  return <ProductoDetalle data={data} />
}
