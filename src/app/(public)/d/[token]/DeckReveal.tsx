'use client'

import { useEffect } from 'react'
import { localeDe, fmtNumL, fmtPctL, type Lang } from '@/lib/dossier/deck-i18n'
import { esTokenValido } from '@/lib/dossier/token'

// Todo el JS del deck: reveal al entrar, conteo de números, punto de navegación
// activo, teclado (↑/↓) y la descarga en PDF. Sin librerías — el presupuesto es
// < 100 KB (skill UI §6).
//
// Las ANIMACIONES son OPT-IN: el estado base (sin `.dp-anim`) muestra el deck
// entero y quieto. Solo si este componente confirma que puede animar añade
// `.dp-anim` y entonces el CSS oculta/rellena/dibuja. Si el JS no llega —3G cubano,
// JS off, error de hidratación— el inversor lee el deck completo igualmente.

// Idioma activo del deck (lo fija `data-lang` en `.dp-page`; 'es' por defecto).
function langActual(): Lang {
  return document.querySelector('.dp-page')?.getAttribute('data-lang') === 'en' ? 'en' : 'es'
}

// Texto final de un contador, en el idioma activo. Lo usan el conteo al terminar y
// `beforeprint`, para que una cifra a medias no se congele en el PDF.
function textoFinal(el: HTMLElement): string {
  const objetivo = parseFloat(el.dataset.count ?? '')
  if (Number.isNaN(objetivo)) return el.textContent ?? ''
  const dec = parseInt(el.dataset.dec ?? '0', 10)
  return fmtNumL(objetivo, dec, langActual()) + (el.dataset.suf ?? '')
}

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
      const fmt = new Intl.NumberFormat(localeDe(langActual()), { minimumFractionDigits: dec, maximumFractionDigits: dec })
      const dur = 1100
      let inicio: number | null = null
      const paso = (ts: number) => {
        if (inicio == null) inicio = ts
        const t = Math.min(1, (ts - inicio) / dur)
        const e = 1 - Math.pow(1 - t, 3)
        el.textContent = fmt.format(objetivo * e) + suf
        if (t < 1) requestAnimationFrame(paso)
        else el.textContent = textoFinal(el)
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

  // ── Acuse de lectura ──
  // Una apertura por sesión. Solo en el enlace REAL `/d/<token>`: la vista previa en
  // borrador es `/d/preview/<id>` y no casa con el patrón, así que no cuenta (mirar tu
  // propio borrador no es que «lo abrió el inversor»). Dedupe con sessionStorage para
  // no sumar recargas. Fire-and-forget; si falla, ni se nota.
  useEffect(() => {
    const m = window.location.pathname.match(/^\/d\/([^/]+)$/)
    const token = m?.[1]
    if (!token || !esTokenValido(token)) return
    const clave = `dossier-visto-${token}`
    try {
      if (sessionStorage.getItem(clave)) return
      sessionStorage.setItem(clave, '1')
    } catch { /* modo privado sin storage: se contará por carga, aceptable */ }
    const url = `/d/${token}/visto`
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(url)
      else fetch(url, { method: 'POST', keepalive: true }).catch(() => {})
    } catch { /* nada que hacer */ }
  }, [])

  // ── Botón ES/EN en vivo ──
  // Solo existe cuando el deck trae versión inglesa (`.dp-lang`). El texto lo
  // intercambia el CSS (clases lang-es/lang-en); aquí solo cambiamos `data-lang` y
  // reformateamos los NÚMEROS y PORCENTAJES al idioma activo (es-ES ↔ en-US).
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.dp-page')
    if (!root) return
    const botones = Array.from(root.querySelectorAll<HTMLElement>('.dp-lang-btn'))
    if (botones.length === 0) return

    const setLang = (lang: Lang) => {
      root.setAttribute('data-lang', lang)
      botones.forEach(b => b.classList.toggle('is-activo', b.dataset.setLang === lang))
      root.querySelectorAll<HTMLElement>('[data-count]').forEach(el => {
        const objetivo = parseFloat(el.dataset.count ?? '')
        if (Number.isNaN(objetivo)) return
        const dec = parseInt(el.dataset.dec ?? '0', 10)
        el.textContent = fmtNumL(objetivo, dec, lang) + (el.dataset.suf ?? '')
      })
      root.querySelectorAll<HTMLElement>('[data-pct]').forEach(el => {
        const v = parseFloat(el.dataset.pct ?? '')
        if (!Number.isNaN(v)) el.textContent = fmtPctL(v, lang)
      })
    }

    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.dp-lang-btn')
      if (!b?.dataset.setLang) return
      setLang(b.dataset.setLang === 'en' ? 'en' : 'es')
    }
    for (const b of botones) b.addEventListener('click', onClick)
    return () => { for (const b of botones) b.removeEventListener('click', onClick) }
  }, [])

  // ── PDF ──
  // El @media print de la hoja hace todo el trabajo (una diapositiva, una página).
  // Aquí solo queda disparar el diálogo y tapar el único agujero que el CSS no
  // puede: los contadores son JS, así que imprimir con una cifra a medio contar la
  // congelaría a medias en el PDF. El resto de la animación ya la neutraliza el CSS.
  useEffect(() => {
    const fijarCifras = () => {
      document.querySelectorAll<HTMLElement>('[data-count]').forEach(el => { el.textContent = textoFinal(el) })
    }
    window.addEventListener('beforeprint', fijarCifras)

    // El portal pide el PDF con ?print=1. Se lee AQUÍ, en cliente, a propósito:
    // leer searchParams en el servidor volvería dinámica una página que es caché
    // de por vida (revalidate = false) y cada inversor pagaría un render.
    // Al `load` y no al montar: las fuentes de marca entran por <link> con
    // display=swap, e imprimir antes las congelaría en la del sistema.
    // Y solo en escritorio, con el MISMO criterio que el CSS que oculta el botón
    // (`.dp-print-btn`): en táctil el print del navegador sale roto. El botón ya no
    // existe ahí, pero la URL con `?print=1` sí —del historial, del autocompletado o
    // copiada de la barra de direcciones y compartida— y sin esto abriría el diálogo
    // roto en un móvil, justo lo que ocultar el botón evita.
    const escritorio = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    if (!escritorio || !new URLSearchParams(window.location.search).has('print')) {
      return () => window.removeEventListener('beforeprint', fijarCifras)
    }
    const imprimir = () => window.print()
    if (document.readyState === 'complete') imprimir()
    else window.addEventListener('load', imprimir, { once: true })

    return () => {
      window.removeEventListener('beforeprint', fijarCifras)
      window.removeEventListener('load', imprimir)
    }
  }, [])

  return (
    // El print() se DIFIERE fuera del handler (setTimeout 0): `window.print()` es
    // síncrono y bloquea el hilo ~segundos mientras el navegador pagina — medido como
    // INP de ~3 s en Vercel. Sacándolo del evento, la interacción devuelve al instante
    // y el diálogo abre en el siguiente tick; el usuario no nota diferencia.
    <button type="button" className="dp-print-btn" onClick={() => setTimeout(() => window.print(), 0)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      PDF
    </button>
  )
}
