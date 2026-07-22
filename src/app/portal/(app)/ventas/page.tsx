import { notFound }              from 'next/navigation'
import { requireModulo }          from '@/app/actions/portal/auth'
import { obtenerVentasResumen } from '@/app/actions/portal/ventas'
import VentasView                from './VentasView'

export const dynamic = 'force-dynamic'

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>
}) {
  await requireModulo('base')
  const data = await obtenerVentasResumen()
  if (!data) notFound()
  // La pestaña activa viaja en la URL (`?t=`), para que volver desde el detalle
  // de una factura caiga en Facturas y no en Ofertas.
  const { t } = await searchParams
  return <VentasView data={data} initialTab={t === 'facturas' ? 'facturas' : 'ofertas'} />
}
