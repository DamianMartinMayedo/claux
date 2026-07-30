import { requireModulo }  from '@/app/actions/portal/auth'
import { obtenerCompras } from '@/app/actions/portal/compras'
import ContabilidadHint   from '@/components/portal/ContabilidadHint'
import EnConstruccion     from '@/components/portal/EnConstruccion'
import ComprasView        from './ComprasView'

export const dynamic = 'force-dynamic'

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  await requireModulo('inventario')
  // El rango viaja en la URL y se aplica EN LA QUERY, no en el cliente: antes se
  // traían TODAS las compras del cliente sin rango ni techo (mismo contrato que los
  // listados de Contabilidad).
  const { desde, hasta } = await searchParams
  const data = await obtenerCompras({ desde, hasta })
  if (!data) {
    return <EnConstruccion titulo="Compras" subtitulo="Gestión de compras y proveedores." />
  }
  return (
    <>
      {/* Aquí y no en Movimientos: confirmar una compra es lo que crea el gasto. */}
      <ContabilidadHint genera="tus compras" />
      <ComprasView data={data} />
    </>
  )
}
