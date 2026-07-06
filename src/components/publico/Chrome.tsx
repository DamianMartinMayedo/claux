// Cabecera y pie compartidos de las páginas públicas de captación
// (landing + diagnóstico). Antes estaban duplicados literalmente en ambas.
import Link from 'next/link'

export function PublicHeader() {
  return (
    <header className="ld-header">
      <Link href="/" className="ld-header-logo" aria-label="CLAUX — inicio">
        <div className="ld-header-logo-icon">C</div>
        <span className="ld-header-logo-text">CLAUX</span>
      </Link>
      <nav className="ld-header-nav">
        <a href="/admin/login" className="btn btn-ghost btn-sm">
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
      <div className="ld-header-logo ld-footer-logo">
        <div className="ld-header-logo-icon">C</div>
        <span className="ld-header-logo-text">CLAUX</span>
      </div>
      <p className="ld-footer-text">
        Hecho para hacer crecer tu negocio. Simple, rápido, sin complicaciones.
      </p>
    </footer>
  )
}
