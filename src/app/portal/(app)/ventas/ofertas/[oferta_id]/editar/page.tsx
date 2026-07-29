import { notFound }        from 'next/navigation'
import {
  obtenerOfertaDetalle,
  obtenerContextoDocumento,
} from '@/app/actions/portal/ventas'
import { requireModulo }   from '@/app/actions/portal/auth'
import EditarOfertaPage    from './EditarOfertaPage'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ oferta_id: string }>
}

export default async function Page({ params }: PageProps) {
  await requireModulo('base')
  const { oferta_id } = await params
  const [detalle, contexto] = await Promise.all([
    obtenerOfertaDetalle(oferta_id),
    obtenerContextoDocumento(),
  ])
  if (!detalle || !contexto) notFound()
  return <EditarOfertaPage data={detalle} contexto={contexto} />
}
