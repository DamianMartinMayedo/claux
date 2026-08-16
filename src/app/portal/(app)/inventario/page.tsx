import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerMovimientos, obtenerRevision } from '@/app/actions/portal/inventario'
import EnConstruccion         from '@/components/portal/EnConstruccion'
import { TOPE_VER_MAS }       from '@/lib/listados'
import { filtrosDeUrl }       from '@/lib/filtros'
import MovimientosView        from './MovimientosView'

export const dynamic = 'force-dynamic'

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { puedeEditar } = await requireAccesoModulo('inventario')
  // El rango viaja en la URL y se aplica EN LA QUERY, como en los listados de
  // Contabilidad: antes se traían 500 filas sin rango y sin decirlo.
  // `limite` lo sube «Traer más»: el techo recorta por fecha descendente, así que sin
  // esto no había forma de llegar a los movimientos VIEJOS.
  const sp = await searchParams
  const { desde, hasta, limite } = sp
  const pedido = Number(limite)
  // Los filtros de la barra se aplican EN LA CONSULTA solo cuando la vista los escala
  // (`?srv=1`), o sea cuando el listado está recortado por el techo.
  const enServidor = filtrosDeUrl(sp, [
    { clave: 'empresa_id', param: 'empresa' },
    { clave: 'tipo' },
    { clave: 'almacen_id', param: 'almacen' },
    { clave: 'motivo' },
  ])
  const [data, revision] = await Promise.all([
    obtenerMovimientos({ desde, hasta, ...enServidor,
      limite: Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined }),
    obtenerRevision(),
  ])
  // El aviso de Contabilidad NO va aquí: lo que genera gastos son las COMPRAS, no
  // los movimientos de almacén, y estaba prometiendo apuntes en la pantalla que no
  // los produce. Vive en /portal/compras.
  return data
    ? <MovimientosView data={data} revision={revision} puedeEditar={puedeEditar} />
    : <EnConstruccion titulo="Movimientos" subtitulo="Stock y movimientos de almacén." />
}
