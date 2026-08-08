import { notFound }          from 'next/navigation'
import type { Metadata }     from 'next'
import { obtenerCitasPublicas } from '@/app/actions/portal/citas'
import { hoyEnTz }           from '@/lib/fecha-tz'
import CitasPublicaForm        from './CitasPublicaForm'
import '../reservar/reserva-publica.css'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

/**
 * COM-5: heredaba «Reservas — CLAUX» y «Reserva tu mesa» del layout público. A una
 * peluquería le decía literalmente «Reserva tu mesa». El título sale del nombre del
 * negocio y de la etiqueta de su sector, como en el catálogo.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const data = await obtenerCitasPublicas(slug)
  if (!data.negocio) return {}
  return {
    title:       `Pedir cita — ${data.negocio.nombre}`,
    description: `Pide tu cita en ${data.negocio.nombre}.`,
  }
}

export default async function CitasPublicaPage({ params }: Props) {
  const { slug } = await params
  const data = await obtenerCitasPublicas(slug)

  if (!data.negocio || !data.client_id) notFound()

  return (
    <div className="rp-page">
      <CitasPublicaForm
        clientId={data.client_id}
        negocio={data.negocio}
        servicios={data.servicios}
        recursos={data.recursos}
        etiquetas={data.etiquetas}
        slug={slug}
        reglas={data.reglas}
        // COM-7: el «hoy» del negocio (America/Havana), no el del navegador.
        hoy={hoyEnTz()}
      />
    </div>
  )
}
