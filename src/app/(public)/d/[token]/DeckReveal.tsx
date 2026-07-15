'use client'

import { useEffect } from 'react'

// Reveal al hacer scroll, OPT-IN. Todo el JS del deck es esto.
//
// El estado base de una sección es VISIBLE; este componente añade `.dp-anim` al
// contenedor y solo entonces el CSS oculta y anima. Al revés (`opacity:0` de base)
// un fallo de JS —3G cubano, JS desactivado, error de hidratación— dejaría el deck
// INVISIBLE para siempre delante de un inversor. Aquí, si el JS no llega, el deck
// simplemente se lee entero sin animación.
export default function DeckReveal() {
  useEffect(() => {
    const root = document.querySelector('.dp-page')
    if (!root) return

    // Respetar la preferencia del sistema: sin animación, nada que hacer.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    if (!('IntersectionObserver' in window)) return

    const secciones = Array.from(root.querySelectorAll('.dp-seccion'))
    if (secciones.length === 0) return

    root.classList.add('dp-anim')   // a partir de aquí el CSS oculta y revela

    const io = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue
        e.target.classList.add('is-visible')
        io.unobserve(e.target)      // una vez revelada, deja de costar
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 })

    for (const s of secciones) io.observe(s)
    return () => io.disconnect()
  }, [])

  return null
}
