import { notFound }             from 'next/navigation'
import {
  obtenerOfertaDetalle,
  obtenerVentasResumen,
} from '@/app/actions/portal/ventas'
import { requireModulo }        from '@/app/actions/portal/auth'
import EditarOfertaPage          from './EditarOfertaPage'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ oferta_id: string }>
}

export default async function Page({ params }: PageProps) {
  await requireModulo('base')
  const { oferta_id } = await params
  const [detalle, resumen] = await Promise.all([
    obtenerOfertaDetalle(oferta_id),
    obtenerVentasResumen(),
  ])
  if (!detalle || !resumen) notFound()
  return <EditarOfertaPage data={detalle} resumen={resumen} />
}
