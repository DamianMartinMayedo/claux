// Cabecera y pie compartidos de las páginas públicas de captación
// (landing + diagnóstico + legales). Antes estaban duplicados literalmente.
import Link from 'next/link'
import EnlacesLegales from './EnlacesLegales'

/**
 * Cabecera de solo marca: las páginas públicas que NO son de captación.
 *
 * La usan los legales y el centro de ayuda. Ninguna de las dos es una página
 * para vender: al visitante que llega de Google no le dicen nada «Acceso
 * clientes» y «Diagnóstico gratis», y al **cliente** —que es quien más las abre,
 * las cookies desde su perfil o una guía desde «Ayuda y soporte»— le están
 * ofreciendo lo que ya tiene contratado.
 *
 * **El logo NO es un enlace.** En `PublicHeader` lleva a `/`, y ese es
 * exactamente el viaje que se evita aquí: se pulsa el logo por costumbre y se
 * acaba en la web comercial, fuera del portal desde el que se venía. La vuelta a
 * la casa sigue estando en el pie, para quien la busque.
 */
export function PublicHeaderMarca() {
  return (
    <header className="pub-header-marca">
      {/* Mismas clases que el logo de la cabecera pública: es la misma marca y el
          mismo par claro/oscuro, no una variante. */}
      <span className="ld-header-logo">
        <img src="/logo_color.svg" alt="CLAUX" className="logo-light" />
        <img src="/logo_blanco.svg" alt="CLAUX" className="logo-dark" />
      </span>
    </header>
  )
}

export function PublicHeader() {
  return (
    <header className="ld-header">
      <Link href="/" className="ld-header-logo" aria-label="CLAUX — inicio">
        <img src="/logo_color.svg" alt="CLAUX" className="logo-light" />
        <img src="/logo_blanco.svg" alt="CLAUX" className="logo-dark" />
      </Link>
      <nav className="ld-header-nav">
        <Link href="/portal" className="btn btn-ghost btn-sm">
          Acceso clientes
        </Link>
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
      {/* Los legales van en el pie COMPARTIDO: deben estar accesibles desde
          cualquier página pública, no solo desde la landing. */}
      <EnlacesLegales className="ld-footer-legal" />
    </footer>
  )
}
