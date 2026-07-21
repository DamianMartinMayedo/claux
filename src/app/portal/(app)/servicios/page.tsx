import { redirect }         from 'next/navigation'
import { requireModulo }    from '@/app/actions/portal/auth'
import { obtenerProductos } from '@/app/actions/portal/productos'
import ProductosView        from '../productos/ProductosView'

export const dynamic = 'force-dynamic'

export default async function ServiciosPage() {
  // Módulo Servicios: catálogo de servicios (products tipo=SERVICIO). Comparte la
  // tabla `products` y la vista con Inventario, pero es su propia página, con su
  // propio gate.
  await requireModulo('servicios')
  const data = await obtenerProductos('SERVICIO')
  if (!data) redirect('/portal/login')
  return <ProductosView data={data} />
}
