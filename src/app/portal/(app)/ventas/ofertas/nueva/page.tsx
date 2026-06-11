import { notFound }             from 'next/navigation'
import { obtenerVentasResumen } from '@/app/actions/portal/ventas'
import { obtenerEmpresas }      from '@/app/actions/portal/empresas'
import NuevaOfertaPage           from './NuevaOfertaPage'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const [resumen, empresasFull] = await Promise.all([
    obtenerVentasResumen(),
    obtenerEmpresas(),
  ])
  if (!resumen) notFound()
  return <NuevaOfertaPage resumen={resumen} empresasFull={empresasFull} />
}
