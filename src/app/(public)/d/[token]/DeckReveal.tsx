'use client'

import { useEffect } from 'react'

// Todo el JS del deck: reveal al entrar, conteo de números, punto de navegación
// activo y teclado (↑/↓). Sin librerías — el presupuesto es < 100 KB (skill UI §6).
//
// Las ANIMACIONES son OPT-IN: el estado base (sin `.dp-anim`) muestra el deck
// entero y quieto. Solo si este componente confirma que puede animar añade
// `.dp-anim` y entonces el CSS oculta/rellena/dibuja. Si el JS no llega —3G cubano,
// JS off, error de hidratación— el inversor lee el deck completo igualmente.
export default function DeckReveal() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.dp-page')
    if (!root) return

    const slides = Array.from(root.querySelectorAll<HTMLElement>('.dp-slide'))
    const dots = Array.from(root.querySelectorAll<HTMLElement>('.dp-nav-dot'))
    if (slides.length === 0) return

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const hasIO = 'IntersectionObserver' in window

    // ── Punto de navegación activo + teclado (útil aun sin animación) ──
    let activo = 0
    const marcarActivo = (i: number) => {
      activo = i
      dots.forEach((d, j) => d.classList.toggle('active', j === i))
    }
    marcarActivo(0)

    const onScroll = () => {
      let best = 0, bestDist = Infinity
      slides.forEach((s, i) => {
        const d = Math.abs(s.getBoundingClientRect().top)
        if (d < bestDist) { bestDist = d; best = i }
      })
      marcarActivo(best)
    }
    const onKey = (e: KeyboardEvent) => {
      const dir = (e.key === 'ArrowDown' || e.key === 'PageDown') ? 1
        : (e.key === 'ArrowUp' || e.key === 'PageUp') ? -1 : 0
      if (!dir) return
      const i = Math.max(0, Math.min(slides.length - 1, activo + dir))
      if (i !== activo) { e.preventDefault(); slides[i].scrollIntoView({ behavior: 'smooth' }) }
    }

    root.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', onKey)

    if (reduce || !hasIO) {
      return () => { root.removeEventListener('scroll', onScroll); window.removeEventListener('keydown', onKey) }
    }

    // ── A partir de aquí, animaciones ──
    // ORDEN CRÍTICO: primero se marcan como ya reveladas las diapositivas que el
    // visitante YA tiene delante, y solo DESPUÉS se activa `.dp-anim`.
    // Al revés se ve el parpadeo de «se carga dos veces»: el servidor pintó el
    // deck entero y el navegador ya lo mostró, así que activar `.dp-anim` de
    // primeras oculta lo que está en pantalla —el gráfico se borra— y el
    // observer lo vuelve a dibujar un frame después. Se nota sobre todo al
    // recargar en mitad del deck, porque el navegador restaura el scroll.
    // Haciéndolo en este orden, esas diapositivas pasan directas a su estado
    // final en el mismo recálculo y no llegan a moverse. Solo se anima lo que
    // el visitante aún no ha visto, que es de lo que va la animación.
    const rootRect = root.getBoundingClientRect()
    for (const s of slides) {
      const r = s.getBoundingClientRect()
      if (r.top < rootRect.bottom && r.bottom > rootRect.top) s.classList.add('is-visible')
    }
    root.classList.add('dp-anim')

    // Conteo de un número de 0 → objetivo (easeOutCubic), formateado como es-ES.
    const contar = (el: HTMLElement) => {
      const objetivo = parseFloat(el.dataset.count ?? '')
      if (Number.isNaN(objetivo)) return
      const dec = parseInt(el.dataset.dec ?? '0', 10)
      const suf = el.dataset.suf ?? ''
      const fmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })
      const dur = 1100
      let inicio: number | null = null
      const paso = (ts: number) => {
        if (inicio == null) inicio = ts
        const t = Math.min(1, (ts - inicio) / dur)
        const e = 1 - Math.pow(1 - t, 3)
        el.textContent = fmt.format(objetivo * e) + suf
        if (t < 1) requestAnimationFrame(paso)
        else el.textContent = fmt.format(objetivo) + suf
      }
      requestAnimationFrame(paso)
    }

    const io = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue
        const s = e.target as HTMLElement
        s.classList.add('is-visible')                                  // dispara reveal/barras/gráfico
        s.querySelectorAll<HTMLElement>('[data-count]').forEach(contar) // números que suben/bajan
        io.unobserve(s)                                                // una vez revelado, deja de costar
      }
    }, { root, threshold: 0.18 })

    for (const s of slides) io.observe(s)

    return () => {
      io.disconnect()
      root.removeEventListener('scroll', onScroll)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return null
}
