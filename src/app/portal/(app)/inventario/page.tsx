import { requireModulo }     from '@/app/actions/portal/auth'
import { obtenerMovimientos, obtenerRevision } from '@/app/actions/portal/inventario'
import EnConstruccion         from '@/components/portal/EnConstruccion'
import MovimientosView        from './MovimientosView'

export const dynamic = 'force-dynamic'

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  await requireModulo('inventario')
  // El rango viaja en la URL y se aplica EN LA QUERY, como en los listados de
  // Contabilidad: antes se traían 500 filas sin rango y sin decirlo.
  const { desde, hasta } = await searchParams
  const [data, revision] = await Promise.all([
    obtenerMovimientos({ desde, hasta }),
    obtenerRevision(),
  ])
  // El aviso de Contabilidad NO va aquí: lo que genera gastos son las COMPRAS, no
  // los movimientos de almacén, y estaba prometiendo apuntes en la pantalla que no
  // los produce. Vive en /portal/compras.
  return data
    ? <MovimientosView data={data} revision={revision} />
    : <EnConstruccion titulo="Movimientos" subtitulo="Stock y movimientos de almacén." />
}
