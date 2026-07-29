import { notFound }            from 'next/navigation'
import { requireModulo }        from '@/app/actions/portal/auth'
import { obtenerVentasResumen } from '@/app/actions/portal/ventas'
import VentasView               from './VentasView'

export const dynamic = 'force-dynamic'

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; desde?: string; hasta?: string; q?: string }>
}) {
  await requireModulo('base')
  // Pestaña, rango y búsqueda viajan en la URL: volver desde el detalle de una factura, o
  // refrescar, conserva lo que el dueño estaba mirando en vez de saltar al estado inicial.
  // El rango se aplica EN LA QUERY (`obtenerVentasResumen`), no filtrando en el cliente.
  const { t, desde, hasta, q } = await searchParams
  const data = await obtenerVentasResumen({
    // `''` explícito = «todo» (sin límite); `undefined` = usa el defecto de 3 meses.
    desde: desde !== undefined ? desde : undefined,
    hasta: hasta !== undefined ? hasta : undefined,
    q,
  })
  if (!data) notFound()
  return <VentasView data={data} initialTab={t === 'facturas' ? 'facturas' : 'ofertas'} />
}
