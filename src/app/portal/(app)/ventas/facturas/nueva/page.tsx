import { notFound }             from 'next/navigation'
import { obtenerVentasResumen } from '@/app/actions/portal/ventas'
import { obtenerEmpresas }      from '@/app/actions/portal/empresas'
import NuevaFacturaPage          from './NuevaFacturaPage'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const [resumen, empresasFull] = await Promise.all([
    obtenerVentasResumen(),
    obtenerEmpresas(),
  ])
  if (!resumen) notFound()
  return <NuevaFacturaPage resumen={resumen} empresasFull={empresasFull} />
}
