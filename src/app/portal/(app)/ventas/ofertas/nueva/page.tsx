import { notFound }                 from 'next/navigation'
import { requireModulo }            from '@/app/actions/portal/auth'
import { obtenerContextoDocumento } from '@/app/actions/portal/ventas'
import NuevaOfertaPage              from './NuevaOfertaPage'

export const dynamic = 'force-dynamic'

export default async function Page() {
  await requireModulo('base')
  const contexto = await obtenerContextoDocumento()
  if (!contexto) notFound()
  return <NuevaOfertaPage contexto={contexto} />
}
