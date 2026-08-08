import { notFound }          from 'next/navigation'
import type { Metadata }     from 'next'
import { obtenerReservasPublicas } from '@/app/actions/portal/reservas'
import { hoyEnTz }           from '@/lib/fecha-tz'
import ReservaPublicaForm    from './ReservaPublicaForm'
import './reserva-publica.css'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

/**
 * COM-5: sin esto la página hereda del layout público el título «Reservas — CLAUX»
 * y la descripción «Reserva tu mesa». El enlace que el negocio comparte por WhatsApp
 * enseñaba la marca del proveedor en vez de la suya. Sin `og:image` a propósito:
 * estas páginas tienen presupuesto de 3G.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const data = await obtenerReservasPublicas(slug)
  if (!data.negocio) return {}
  return {
    title:       `Reservar — ${data.negocio.nombre}`,
    description: `Reserva tu mesa en ${data.negocio.nombre}.`,
  }
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
      // COM-7: el «hoy» del NEGOCIO (America/Havana), no el del reloj del visitante.
      // Un cliente en España veía un «Hoy» distinto del que usó la RPC y la tira de
      // días se desalineaba con la disponibilidad real.
      hoy={hoyEnTz()}
    />
  )
}
