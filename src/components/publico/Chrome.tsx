// Cabecera y pie compartidos de las páginas públicas de captación
// (landing + diagnóstico). Antes estaban duplicados literalmente en ambas.
import Link from 'next/link'

export function PublicHeader() {
  return (
    <header className="ld-header">
      <Link href="/" className="ld-header-logo" aria-label="CLAUX — inicio">
        <img src="/logo_color.svg" alt="CLAUX" className="logo-light" />
        <img src="/logo_blanco.svg" alt="CLAUX" className="logo-dark" />
      </Link>
      <nav className="ld-header-nav">
        <a href="/portal/login" className="btn btn-ghost btn-sm">
          Acceso clientes
        </a>
        <Link href="/diagnostico" className="btn btn-primary btn-sm ld-header-cta">
          Diagnóstico gratis
        </Link>
      </nav>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="ld-footer">
      <Link href="/" className="ld-header-logo ld-footer-logo" aria-label="CLAUX">
        <img src="/logo_color.svg" alt="CLAUX" className="logo-light" />
        <img src="/logo_blanco.svg" alt="CLAUX" className="logo-dark" />
      </Link>
      <p className="ld-footer-text">
        Hecho para hacer crecer tu negocio. Simple, rápido, sin complicaciones.
      </p>
    </footer>
  )
}
