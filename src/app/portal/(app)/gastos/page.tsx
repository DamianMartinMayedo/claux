import { notFound }            from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerGastosCobros } from '@/app/actions/portal/gastos'
import { TOPE_VER_MAS }        from '@/lib/listados'
import GastosView              from './GastosView'

export const dynamic = 'force-dynamic'

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; q?: string; limite?: string }>
}) {
  const { puedeEditar } = await requireAccesoModulo('base')
  // Rango y búsqueda viajan en la URL y se aplican EN LA QUERY. Este listado es el que
  // más crece: una nómina confirmada escribe hasta 5 filas (migs. 142-144).
  // `limite` lo sube «Ver más»: el techo protege la conexión, pero tiene que haber
  // una forma de llegar a lo viejo sin adivinar un rango a mano.
  const { desde, hasta, q, limite } = await searchParams
  const pedido = Number(limite)
  const data = await obtenerGastosCobros({
    desde, hasta, q,
    limite: Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined,
  })
  if (!data) notFound()
  return <GastosView data={data} puedeEditar={puedeEditar} />
}
