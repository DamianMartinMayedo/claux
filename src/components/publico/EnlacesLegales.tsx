import { Fragment } from 'react'
import Link from 'next/link'
import { ENLACES_LEGALES } from '@/lib/publico/legal'

interface Props {
  /** Clase extra para el hueco donde se coloca (márgenes del contenedor). */
  className?: string
  /**
   * Abre en pestaña nueva. Para el portal: quien está trabajando dentro no
   * debería perder lo que tiene a medias por leer las cookies.
   */
  nuevaPestana?: boolean
}

// Enlaces legales, separados por puntos. Se usan en el pie público y en el
// perfil del portal; el listado sale de ENLACES_LEGALES para que no haya dos
// sitios que mantener cuando cambie una página.
export default function EnlacesLegales({ className = '', nuevaPestana = false }: Props) {
  const extra = nuevaPestana
    ? { target: '_blank', rel: 'noopener noreferrer' as const }
    : {}

  return (
    <nav className={`legal-links ${className}`.trim()} aria-label="Información legal">
      {ENLACES_LEGALES.map((e, i) => (
        <Fragment key={e.href}>
          {/* El separador es un <span> aparte, no un ::before del enlace: dentro
              del <a> sería clicable y se subrayaría con él. */}
          {i > 0 && <span className="legal-links-sep" aria-hidden="true">·</span>}
          <Link href={e.href} {...extra}>{e.titulo}</Link>
        </Fragment>
      ))}
    </nav>
  )
}
