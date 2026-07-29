import { notFound }            from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerGastosCobros } from '@/app/actions/portal/gastos'
import GastosView              from './GastosView'

export const dynamic = 'force-dynamic'

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; q?: string }>
}) {
  const { puedeEditar } = await requireAccesoModulo('base')
  // Rango y búsqueda viajan en la URL y se aplican EN LA QUERY. Este listado es el que
  // más crece: una nómina confirmada escribe hasta 5 filas (migs. 142-144).
  const { desde, hasta, q } = await searchParams
  const data = await obtenerGastosCobros({ desde, hasta, q })
  if (!data) notFound()
  return <GastosView data={data} puedeEditar={puedeEditar} />
}
