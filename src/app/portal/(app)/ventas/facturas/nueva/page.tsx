import { notFound }             from 'next/navigation'
import { requireModulo }        from '@/app/actions/portal/auth'
import { obtenerVentasResumen } from '@/app/actions/portal/ventas'
import NuevaFacturaPage          from './NuevaFacturaPage'

export const dynamic = 'force-dynamic'

export default async function Page() {
  await requireModulo('base')
  const resumen = await obtenerVentasResumen()
  if (!resumen) notFound()
  return <NuevaFacturaPage resumen={resumen} />
}
