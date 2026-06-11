import { redirect }         from 'next/navigation'
import { obtenerProductos }  from '@/app/actions/portal/productos'
import ProductosView         from './ProductosView'

export const dynamic = 'force-dynamic'

export default async function ProductosPage() {
  const data = await obtenerProductos()
  if (!data) redirect('/portal/login')
  return <ProductosView data={data} />
}
