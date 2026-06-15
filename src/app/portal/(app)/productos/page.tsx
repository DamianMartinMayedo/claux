import { redirect }         from 'next/navigation'
import { requireModulo }     from '@/app/actions/portal/auth'
import { obtenerProductos }  from '@/app/actions/portal/productos'
import ProductosView         from './ProductosView'

export const dynamic = 'force-dynamic'

export default async function ProductosPage() {
  await requireModulo('inventario')
  const data = await obtenerProductos()
  if (!data) redirect('/portal/login')
  return <ProductosView data={data} />
}
