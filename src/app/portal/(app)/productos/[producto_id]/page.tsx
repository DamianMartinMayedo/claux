import { notFound } from 'next/navigation'
import { requireModulo }           from '@/app/actions/portal/auth'
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
  if (data === null) {
    // Si no hay sesión → login; si el producto no existe → 404
    // obtenerProductoDetalle devuelve null en ambos casos, diferenciamos
    // llamando a getPortalSession es costoso; simplemente redirigimos al login
    // si la sesión expiró, el middleware lo capturará
    notFound()
  }
  return <ProductoDetalle data={data} />
}
