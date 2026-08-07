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
  /**
   * A dónde vuelve el «Volver» de la página legal. Ruta interna («/portal/perfil»).
   *
   * Viaja EXPLÍCITA y no se adivina: en pestaña nueva no hay historia que deshacer,
   * y el `referrer` —que era el plan B— lo borra el propio `rel="noreferrer"` del
   * enlace, así que el botón acababa siempre en la landing. Sacaba a la calle a un
   * cliente que solo había abierto las cookies desde su perfil.
   */
  volverA?: string
}

// Enlaces legales, separados por puntos. Se usan en el pie público y en el
// perfil del portal; el listado sale de ENLACES_LEGALES para que no haya dos
// sitios que mantener cuando cambie una página.
export default function EnlacesLegales({ className = '', nuevaPestana = false, volverA }: Props) {
  const extra = nuevaPestana
    ? { target: '_blank', rel: 'noopener noreferrer' as const }
    : {}
  // Solo rutas internas: el parámetro acaba en un `router.push`, y aceptar cualquier
  // cosa sería una redirección abierta desde una página pública. `//` fuera, que es
  // una URL absoluta disfrazada de ruta.
  const destino = volverA && volverA.startsWith('/') && !volverA.startsWith('//') ? volverA : null
  const sufijo = destino ? `?volver=${encodeURIComponent(destino)}` : ''

  return (
    <nav className={`legal-links ${className}`.trim()} aria-label="Información legal">
      {ENLACES_LEGALES.map((e, i) => (
        <Fragment key={e.href}>
          {/* El separador es un <span> aparte, no un ::before del enlace: dentro
              del <a> sería clicable y se subrayaría con él. */}
          {i > 0 && <span className="legal-links-sep" aria-hidden="true">·</span>}
          <Link href={`${e.href}${sufijo}`} {...extra}>{e.titulo}</Link>
        </Fragment>
      ))}
    </nav>
  )
}
