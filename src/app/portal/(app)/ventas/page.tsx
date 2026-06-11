import { notFound }              from 'next/navigation'
import { obtenerVentasResumen } from '@/app/actions/portal/ventas'
import VentasView                from './VentasView'

export const dynamic = 'force-dynamic'

export default async function VentasPage() {
  const data = await obtenerVentasResumen()
  if (!data) notFound()
  return <VentasView data={data} />
}
