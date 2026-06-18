import { requireModulo }     from '@/app/actions/portal/auth'
import { obtenerMovimientos } from '@/app/actions/portal/inventario'
import EnConstruccion         from '@/components/portal/EnConstruccion'
import MovimientosView        from './MovimientosView'

export const dynamic = 'force-dynamic'

export default async function InventarioPage() {
  await requireModulo('inventario')
  const data = await obtenerMovimientos()
  if (!data) {
    return <EnConstruccion titulo="Movimientos" subtitulo="Stock y movimientos de almacén." />
  }
  return <MovimientosView data={data} />
}
