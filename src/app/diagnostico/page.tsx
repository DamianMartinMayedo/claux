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

// ISR: las opciones (sectores y módulos) salen del catálogo real; revalidamos
// para reflejar cambios del admin sin redeploy.
export const revalidate = 3600

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
