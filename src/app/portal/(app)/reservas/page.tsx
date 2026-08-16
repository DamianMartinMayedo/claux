import { notFound }        from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerReservas } from '@/app/actions/portal/reservas'
import { TOPE_VER_MAS }    from '@/lib/listados'
import { filtrosDeUrl }    from '@/lib/filtros'
import ReservasView        from './ReservasView'

export const dynamic = 'force-dynamic'

export default async function ReservasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { puedeEditar } = await requireAccesoModulo('reservas_citas')
  // Rango y búsqueda viajan en la URL y se aplican EN LA QUERY. Antes esta pantalla se
  // traía la historia ENTERA de reservas y escondía en el navegador todo salvo el día de
  // hoy: un negocio con veinte reservas al día son ~7.300 filas al año pagadas en 3G para
  // enseñar ocho. `limite` lo sube «Ver más».
  const sp = await searchParams
  const pedido = Number(sp.limite)
  // Los filtros de la barra solo se aplican EN LA CONSULTA cuando la vista los escala
  // (`?srv=1`), o sea cuando el listado está recortado por el techo y filtrar en el
  // navegador solo miraría las filas traídas.
  const enServidor = filtrosDeUrl(sp, [
    { clave: 'estado' },
    { clave: 'categoria', param: 'franja' },
  ])
  const data = await obtenerReservas({
    desde: sp.desde, hasta: sp.hasta, q: sp.q,
    ...enServidor,
    limite: Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined,
  })
  if (!data) notFound()
  return <ReservasView data={data} puedeEditar={puedeEditar} />
}
