import { notFound }        from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerNominas }  from '@/app/actions/portal/rrhh'
import { TOPE_VER_MAS }    from '@/lib/listados'
import NominaView          from './NominaView'

export const dynamic = 'force-dynamic'

export default async function NominaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { puedeEditar } = await requireAccesoModulo('rrhh')
  // El AÑO es la granularidad de esta pantalla —el período de una nómina no son unos
  // días sueltos—, así que acota EN LA CONSULTA en vez de traerlas todas y filtrar en
  // el navegador. `limite` lo sube «Traer más» desde `<AvisoTope>`: el techo protege el
  // primer pintado, que es el que se paga en 3G, pero tiene que haber forma de llegar a
  // lo VIEJO, porque el techo recorta por período descendente.
  const { anio, limite } = await searchParams
  const pedido = Number(limite)
  const data = await obtenerNominas({
    anio,
    limite: Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined,
  })
  if (!data) notFound()
  return <NominaView data={data} puedeEditar={puedeEditar} />
}
