'use client'

import { useEffect } from 'react'

// Todo el JS de la landing: el revelado al hacer scroll y el fondo de la
// cabecera. Ambos son OPT-IN — el estado base del HTML/CSS ya es correcto y esto
// solo lo mejora, así que un fallo de JS (3G cubano, JS desactivado, error de
// hidratación) degrada bien en vez de romper la página.
export default function LandingAnim() {
  useEffect(() => {
    const root = document.querySelector('.ld-page')
    if (!root) return

    const observers: IntersectionObserver[] = []
    if ('IntersectionObserver' in window) {
      observers.push(...cabecera(root), ...reveal(root))
    }
    return () => observers.forEach((io) => io.disconnect())
  }, [])

  return null
}

// La cabecera es fixed y arranca con fondo propio. Mientras tenga detrás el
// degradado del hero se vuelve transparente, para que los dos se lean como un
// único bloque; en cuanto ese degradado deja de estar detrás, recupera el fondo
// y sigue siendo legible sobre el resto de secciones.
//
// No depende de prefers-reduced-motion: esto no es una animación, es que la
// barra se lea. Solo la transición de color respeta esa preferencia, y de eso ya
// se encarga el bloque global de 05-admin-paginas.css.
function cabecera(root: Element): IntersectionObserver[] {
  const header = root.querySelector('.ld-header')
  const fin = root.querySelector('.ld-hero-fin')
  if (!header || !fin) return []

  const io = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        // El marcador va al final del degradado: si aún está en pantalla o por
        // debajo, la cabecera lo tiene detrás.
        const conDegradadoDetras = e.isIntersecting || e.boundingClientRect.top > 0
        header.classList.toggle('is-arriba', conDegradadoDetras)
      }
    },
    { threshold: 0 },
  )
  io.observe(fin)
  return [io]
}

// Revelado al hacer scroll. El estado base de cada bloque es VISIBLE; esto añade
// `.ld-anim` a `.ld-page` y solo entonces el CSS oculta y anima. Al revés
// (`opacity:0` de base) un fallo de JS dejaría toda la landing bajo el hero
// invisible para siempre. Mismo patrón que DeckReveal.
//
// Un único observer para toda la página: antes había un componente cliente con
// estado por bloque (13 en total, 13 re-renders).
function reveal(root: Element): IntersectionObserver[] {
  // Respetar la preferencia del sistema: sin animación, nada que hacer.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return []

  const bloques = Array.from(root.querySelectorAll('.reveal, .reveal-stagger'))
  if (bloques.length === 0) return []

  root.classList.add('ld-anim') // a partir de aquí el CSS oculta y revela

  const io = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue
        e.target.classList.add('is-visible')
        io.unobserve(e.target) // una vez revelado, deja de costar
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
  )

  for (const b of bloques) io.observe(b)
  return [io]
}
