import { notFound } from 'next/navigation'
import { requireModulo }          from '@/app/actions/portal/auth'
import { obtenerProductoDetalle } from '@/app/actions/portal/productos'
import ProductoDetalle            from './ProductoDetalle'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ producto_id: string }>
}

export default async function ProductoDetallePage({ params }: Props) {
  await requireModulo('inventario')
  const { producto_id } = await params
  const data = await obtenerProductoDetalle(producto_id)
  // Debe ser un producto FÍSICO: los servicios viven en /portal/servicios.
  if (data === null || data.producto.tipo !== 'PRODUCTO') notFound()
  return <ProductoDetalle data={data} />
}
