import { notFound, redirect }     from 'next/navigation'
import { requireAccesoModulo }    from '@/app/actions/portal/auth'
import { obtenerProductoDetalle } from '@/app/actions/portal/productos'
import ProductoDetalle            from '../../../productos/[producto_id]/ProductoDetalle'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ producto_id: string }>
}

export default async function CajaProductoDetallePage({ params }: Props) {
  // La ficha del artículo de mostrador. Es la MISMA vista que la de Inventario: ya
  // sabe esconder existencias y movimientos cuando el cliente no lleva stock
  // (`data.tieneInventario`) y costes cuando nadie los lee (`data.usaCostes`), así que
  // aquí queda nombre, precios y categoría.
  const { puedeEditar } = await requireAccesoModulo('caja')
  const { producto_id } = await params
  const data = await obtenerProductoDetalle(producto_id)
  if (data === null) notFound()
  // Cada tipo se ve donde vive. Con el módulo contratado, la ficha buena es la suya
  // —mismo criterio que la lista (`modoCatalogoMostrador`)—; sin él, esta.
  if (data.producto.tipo === 'PRODUCTO' && data.tieneInventario) {
    redirect(`/portal/productos/${producto_id}`)
  }
  if (data.producto.tipo === 'SERVICIO' && data.tieneServicios) {
    redirect(`/portal/servicios/${producto_id}`)
  }
  return <ProductoDetalle data={data} puedeEditar={puedeEditar} />
}
