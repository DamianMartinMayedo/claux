import { notFound }              from 'next/navigation'
import { requireAlgunModulo }     from '@/app/actions/portal/auth'
import { obtenerTerceroDetalle }  from '@/app/actions/portal/terceros'
import TerceroDetalle             from './TerceroDetalle'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ tercero_id: string }>
}

export default async function TerceroDetallePage({ params }: Props) {
  await requireAlgunModulo(['base', 'inventario'])
  const { tercero_id } = await params
  const data = await obtenerTerceroDetalle(tercero_id)
  if (!data) notFound()
  return <TerceroDetalle data={data} />
}
