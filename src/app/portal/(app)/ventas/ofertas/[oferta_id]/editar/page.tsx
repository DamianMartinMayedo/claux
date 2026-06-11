import { notFound }             from 'next/navigation'
import {
  obtenerOfertaDetalle,
  obtenerVentasResumen,
} from '@/app/actions/portal/ventas'
import { obtenerEmpresas }      from '@/app/actions/portal/empresas'
import EditarOfertaPage          from './EditarOfertaPage'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ oferta_id: string }>
}

export default async function Page({ params }: PageProps) {
  const { oferta_id } = await params
  const [detalle, resumen, empresasFull] = await Promise.all([
    obtenerOfertaDetalle(oferta_id),
    obtenerVentasResumen(),
    obtenerEmpresas(),
  ])
  if (!detalle || !resumen) notFound()
  return <EditarOfertaPage data={detalle} resumen={resumen} empresasFull={empresasFull} />
}
