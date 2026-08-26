import { redirect }                                  from 'next/navigation'
import { requireAccesoModulo }                       from '@/app/actions/portal/auth'
import { modoCatalogoMostrador, obtenerProductos }   from '@/app/actions/portal/productos'
import ProductosView                                 from '../../productos/ProductosView'

export const dynamic = 'force-dynamic'

export default async function CajaProductosPage() {
  // El catálogo del MOSTRADOR. Existe porque el punto de venta se contrata solo: sin
  // esta página, un cliente con Caja y sin Inventario bajaba la rejilla vacía y tenía
  // que teclear nombre y precio en cada venta. Aquí cataloga sus artículos una vez.
  //
  // No es un catálogo paralelo: son filas normales de `products`, las mismas que lee la
  // semilla. El día que contrate Inventario o Servicios su catálogo ya está, con
  // existencias a 0 — no hay migración de datos que hacer.
  const { puedeEditar } = await requireAccesoModulo('caja')
  // Qué lleva esta página depende de qué módulos falten: lo que no tiene otro sitio
  // donde vivir. Un barbero solo-Caja vende cortes Y champú, y los dos van en la rejilla.
  const modo = await modoCatalogoMostrador()
  if (modo === null) redirect('/portal/login')
  // Con Inventario Y Servicios cada tipo tiene su propia página (con stock, almacenes y
  // movimientos, o con acuerdos). Un cliente, una página: aquí solo llega a quien le falta una.
  if (modo === 'NINGUNO') redirect('/portal/productos')
  const data = await obtenerProductos(modo)
  if (!data) redirect('/portal/login')
  return <ProductosView data={data} puedeEditar={puedeEditar} />
}
