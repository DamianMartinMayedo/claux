import { notFound }          from 'next/navigation'
import { obtenerCitasPublicas } from '@/app/actions/portal/citas'
import CitasPublicaForm        from './CitasPublicaForm'
import '../reservar/reserva-publica.css'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
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
      />
    </div>
  )
}
