import { notFound }      from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerCitasData } from '@/app/actions/portal/citas'
import { TOPE_VER_MAS }  from '@/lib/listados'
import { filtrosDeUrl }  from '@/lib/filtros'
import CitasView          from './CitasView'
import SolicitarAcceso     from '@/components/portal/SolicitarAcceso'

export const dynamic = 'force-dynamic'

export default async function CitasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { puedeEditar } = await requireAccesoModulo('agenda')
  // Rango y búsqueda viajan en la URL y se aplican EN LA QUERY. Antes esta pantalla se
  // traía la agenda ENTERA y escondía en el navegador todo salvo el día de hoy.
  const sp = await searchParams
  const pedido = Number(sp.limite)
  const enServidor = filtrosDeUrl(sp, [
    { clave: 'estado' },
    { clave: 'categoria', param: 'recurso' },
  ])
  const data = await obtenerCitasData({
    desde: sp.desde, hasta: sp.hasta, q: sp.q,
    ...enServidor,
    limite: Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined,
  })
  if (!data) notFound()
  return (
    <CitasView data={data} puedeEditar={puedeEditar}>
      {!puedeEditar && <SolicitarAcceso modulo="agenda" />}
    </CitasView>
  )
}
