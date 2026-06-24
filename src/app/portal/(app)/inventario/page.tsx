import { requireModulo }     from '@/app/actions/portal/auth'
import { obtenerMovimientos } from '@/app/actions/portal/inventario'
import ContabilidadHint       from '@/components/portal/ContabilidadHint'
import EnConstruccion         from '@/components/portal/EnConstruccion'
import MovimientosView        from './MovimientosView'

export const dynamic = 'force-dynamic'

export default async function InventarioPage() {
  await requireModulo('inventario')
  const data = await obtenerMovimientos()
  return (
    <>
      <ContabilidadHint genera="tus compras" />
      {data
        ? <MovimientosView data={data} />
        : <EnConstruccion titulo="Movimientos" subtitulo="Stock y movimientos de almacén." />}
    </>
  )
}
