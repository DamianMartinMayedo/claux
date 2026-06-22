import type { Metadata } from 'next'
import Link from 'next/link'
import { DiagnosticoForm } from './DiagnosticoForm'

export const metadata: Metadata = {
  title: 'Diagnóstico gratuito para tu negocio',
  description:
    'Responde 4 preguntas y descubre qué módulos de CLAUX necesita tu negocio. Sin compromiso, en 2 minutos.',
  openGraph: {
    title: 'CLAUX — Diagnóstico gratuito para tu negocio',
    description:
      'Responde 4 preguntas y descubre qué módulos de CLAUX necesita tu negocio.',
  },
}

export default function DiagnosticoPage() {
  return (
    <div>
      <header className="ld-header">
        <Link href="/landing" className="ld-header-logo">
          <div className="ld-header-logo-icon">C</div>
          <span className="ld-header-logo-text">CLAUX</span>
        </Link>
        <nav className="ld-header-nav">
          <a href="/admin/login" className="btn btn-ghost btn-sm">
            Acceso clientes
          </a>
        </nav>
      </header>

      <div className="dg-container">
        <DiagnosticoForm />
      </div>

      <footer className="ld-footer">
        <div className="ld-header-logo">
          <div className="ld-header-logo-icon">C</div>
          <span className="ld-header-logo-text">CLAUX</span>
        </div>
        <p className="mt-3">
          Hecho para negocios cubanos. Simple, rápido, sin complicaciones.
        </p>
      </footer>
    </div>
  )
}
