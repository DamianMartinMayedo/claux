import { notFound }             from 'next/navigation'
import { requireModulo }        from '@/app/actions/portal/auth'
import { obtenerVentasResumen } from '@/app/actions/portal/ventas'
import NuevaOfertaPage           from './NuevaOfertaPage'

export const dynamic = 'force-dynamic'

export default async function Page() {
  await requireModulo('base')
  const resumen = await obtenerVentasResumen()
  if (!resumen) notFound()
  return <NuevaOfertaPage resumen={resumen} />
}
