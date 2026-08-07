import { requireModulo }  from '@/app/actions/portal/auth'
import { obtenerCompras } from '@/app/actions/portal/compras'
import { TOPE_VER_MAS }   from '@/lib/listados'
import { filtrosDeUrl }   from '@/lib/filtros'
import ContabilidadHint   from '@/components/portal/ContabilidadHint'
import EnConstruccion     from '@/components/portal/EnConstruccion'
import ComprasView        from './ComprasView'

export const dynamic = 'force-dynamic'

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireModulo('inventario')
  // El rango viaja en la URL y se aplica EN LA QUERY, no en el cliente: antes se
  // traían TODAS las compras del cliente sin rango ni techo (mismo contrato que los
  // listados de Contabilidad).
  const sp = await searchParams
  const { desde, hasta, limite } = sp
  // El filtro de la barra se aplica EN LA CONSULTA solo cuando la vista lo escala (`?srv=1`),
  // o sea cuando el listado está recortado por el techo.
  const enServidor = filtrosDeUrl(sp, [{ clave: 'estado' }])
  // `limite` lo sube «Traer más». El techo protege el primer pintado, que es el que se
  // paga en 3G, pero tiene que haber forma de llegar a lo VIEJO —el techo recorta por
  // fecha descendente— sin adivinar un rango a mano.
  const pedido = Number(limite)
  const data = await obtenerCompras({ desde, hasta, ...enServidor,
    limite: Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined })
  if (!data) {
    return <EnConstruccion titulo="Compras" subtitulo="Gestión de compras y proveedores." />
  }
  return (
    <>
      <ComprasView data={data} />
      {/* Aquí y no en Movimientos: confirmar una compra es lo que crea el gasto. */}
      <ContabilidadHint genera="tus compras" />
    </>
  )
}
