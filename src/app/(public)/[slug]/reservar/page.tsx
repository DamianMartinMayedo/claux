import { notFound }          from 'next/navigation'
import { obtenerReservasPublicas } from '@/app/actions/portal/reservas'
import ReservaPublicaForm    from './ReservaPublicaForm'
import './reserva-publica.css'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function ReservaPublicaPage({ params }: Props) {
  const { slug } = await params
  const data = await obtenerReservasPublicas(slug)

  if (!data.negocio || !data.client_id) notFound()

  // El propio formulario ya renderiza su contenedor `.rp-page` (centrado + ancho
  // fijo). No envolver aquí: el doble `.rp-page` dejaba la tarjeta en un padre
  // shrink-to-fit y su ancho variaba según el contenido de cada paso.
  return (
    <ReservaPublicaForm
      franjas={data.franjas}
      clientId={data.client_id}
      negocio={data.negocio}
      slug={slug}
      reglas={data.reglas}
    />
  )
}
