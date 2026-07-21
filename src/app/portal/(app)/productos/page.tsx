import { redirect }         from 'next/navigation'
import { requireModulo }    from '@/app/actions/portal/auth'
import { obtenerProductos } from '@/app/actions/portal/productos'
import ProductosView        from './ProductosView'

export const dynamic = 'force-dynamic'

export default async function ProductosPage() {
  // Inventario: catálogo de productos FÍSICOS. Los servicios tienen su propio
  // módulo y su página (/portal/servicios); comparten la tabla `products`, no esta
  // página.
  await requireModulo('inventario')
  const data = await obtenerProductos('PRODUCTO')
  if (!data) redirect('/portal/login')
  return <ProductosView data={data} />
}
