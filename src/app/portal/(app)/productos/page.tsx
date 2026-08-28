import { redirect }              from 'next/navigation'
import { requireAccesoModulo }   from '@/app/actions/portal/auth'
import { obtenerProductos }      from '@/app/actions/portal/productos'
import ProductosView             from './ProductosView'
import SolicitarAcceso            from '@/components/portal/SolicitarAcceso'
import CupoNivel from '@/components/portal/CupoNivel'

export const dynamic = 'force-dynamic'

export default async function ProductosPage() {
  // Inventario: catálogo de productos FÍSICOS. Los servicios tienen su propio
  // módulo y su página (/portal/servicios); comparten la tabla `products`, no esta
  // página.
  const { puedeEditar } = await requireAccesoModulo('inventario')
  const data = await obtenerProductos('PRODUCTO')
  if (!data) redirect('/portal/login')
  return (
    <ProductosView data={data} puedeEditar={puedeEditar}>
      <CupoNivel dim="productos" />
      {!puedeEditar && <SolicitarAcceso modulo="inventario" />}
    </ProductosView>
  )
}
