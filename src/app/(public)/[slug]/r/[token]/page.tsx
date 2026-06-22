import { notFound } from 'next/navigation'
import { obtenerReservaPublicaPorToken } from '@/app/actions/portal/reservas'
import GestionReservaView from './GestionReservaView'
import '../../reservar/reserva-publica.css'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string; token: string }>
}

export default async function GestionReservaPage({ params }: Props) {
  const { token } = await params
  const data = await obtenerReservaPublicaPorToken(token)
  if (!data) notFound()

  return (
    <div className="rp-page">
      <GestionReservaView data={data} />
    </div>
  )
}
