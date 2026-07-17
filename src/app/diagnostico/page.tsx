import type { Metadata } from 'next'
import { obtenerCatalogoPublico } from '@/lib/publico/catalogo'
import { PublicHeader, PublicFooter } from '@/components/publico/Chrome'
import { DiagnosticoForm } from './DiagnosticoForm'

export const metadata: Metadata = {
  title: 'Diagnóstico gratuito para tu negocio',
  description:
    'Responde 4 preguntas y descubre qué módulos de CLAUX encajan con tu negocio. Sin compromiso, en 2 minutos.',
  alternates: { canonical: '/diagnostico' },
  openGraph: {
    title: 'CLAUX — Diagnóstico gratuito para tu negocio',
    description: 'Responde 4 preguntas y descubre qué módulos de CLAUX encajan con tu negocio.',
    url: '/diagnostico',
  },
}

// Render en RUNTIME, no en el build (mismo motivo que la landing): las opciones
// del diagnóstico salen del catálogo, que se lee con el service_role «sensitive»
// —ausente en el build—. Prerenderizarlo aquí dejaría el formulario SIN opciones
// (sectores y necesidades vacíos) hasta la primera revalidación: no es un detalle
// estético, rompe el embudo. En runtime la clave está y las opciones cargan.
export const dynamic = 'force-dynamic'

export default async function DiagnosticoPage() {
  const { modulos, sectores, necesidades } = await obtenerCatalogoPublico()

  return (
    <div>
      <PublicHeader />
      <div className="dg-container">
        <DiagnosticoForm modulos={modulos} sectores={sectores} necesidades={necesidades} />
      </div>
      <PublicFooter />
    </div>
  )
}
