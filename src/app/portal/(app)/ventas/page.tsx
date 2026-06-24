import { notFound }              from 'next/navigation'
import { requireModulo }          from '@/app/actions/portal/auth'
import { obtenerVentasResumen } from '@/app/actions/portal/ventas'
import VentasView                from './VentasView'

export const dynamic = 'force-dynamic'

export default async function VentasPage() {
  await requireModulo('base')
  const data = await obtenerVentasResumen()
  if (!data) notFound()
  return <VentasView data={data} />
}
