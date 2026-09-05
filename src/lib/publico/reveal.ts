// ── El JS de un deck público — común al dossier y a la propuesta ─────────────
//
// Las dos páginas públicas son el mismo artefacto: diapositivas 16:9 apiladas en
// un contenedor con scroll, puntos de navegación al margen, y un `@media print`
// que convierte cada diapositiva en una página del PDF. Esto es todo lo que
// tienen en común, sacado del `DeckReveal` del dossier sin cambiarle una coma de
// comportamiento; lo específico de cada uno (el conteo de cifras y el botón
// ES/EN del dossier) se queda en su componente y entra por `alRevelar`.
//
// Sin librerías: el presupuesto de la página pública es < 100 KB (skill UI §6).
//
// Las ANIMACIONES son OPT-IN. El estado base —sin la clase de animación— muestra
// el deck entero y quieto; solo si esto confirma que puede animar la añade, y
// entonces el CSS oculta, rellena y dibuja. Si el JS no llega (3G cubano, JS
// desactivado, error de hidratación) el documento se lee completo igualmente.

export type OpcionesReveal = {
  /** Contenedor con scroll: `.dp-page` en el dossier, `.pp-page` en la propuesta. */
  raiz: string
  /** Cada diapositiva. */
  slide: string
  /** Punto de navegación al margen. */
  dot: string
  /** Clase que enciende las animaciones en el CSS (`dp-anim`, `pp-anim`). */
  claseAnim: string
  /** Extra al revelar una diapositiva: el dossier cuenta ahí sus cifras. */
  alRevelar?: (slide: HTMLElement) => void
}

/**
 * Monta reveal al entrar, punto activo y navegación por teclado. Devuelve la
 * función de limpieza para el `useEffect`; si no encuentra la raíz o no hay
 * diapositivas, devuelve un no-op y no toca nada.
 */
export function montarReveal(o: OpcionesReveal): () => void {
  const root = document.querySelector<HTMLElement>(o.raiz)
  if (!root) return () => {}

  const slides = Array.from(root.querySelectorAll<HTMLElement>(o.slide))
  const dots = Array.from(root.querySelectorAll<HTMLElement>(o.dot))
  if (slides.length === 0) return () => {}

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
  // visitante YA tiene delante, y solo DESPUÉS se activa la clase de animación.
  // Al revés se ve el parpadeo de «se carga dos veces»: el servidor pintó el
  // deck entero y el navegador ya lo mostró, así que activar la animación de
  // primeras oculta lo que está en pantalla —el gráfico se borra— y el observer
  // lo vuelve a dibujar un frame después. Se nota sobre todo al recargar en
  // mitad del deck, porque el navegador restaura el scroll. Haciéndolo en este
  // orden, esas diapositivas pasan directas a su estado final en el mismo
  // recálculo y no llegan a moverse. Solo se anima lo que el visitante aún no ha
  // visto, que es de lo que va la animación.
  const rootRect = root.getBoundingClientRect()
  for (const s of slides) {
    const r = s.getBoundingClientRect()
    if (r.top < rootRect.bottom && r.bottom > rootRect.top) s.classList.add('is-visible')
  }
  root.classList.add(o.claseAnim)

  const io = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue
      const s = e.target as HTMLElement
      s.classList.add('is-visible')  // dispara reveal/barras/gráfico
      o.alRevelar?.(s)
      io.unobserve(s)                // una vez revelado, deja de costar
    }
  }, { root, threshold: 0.18 })

  for (const s of slides) io.observe(s)

  return () => {
    io.disconnect()
    root.removeEventListener('scroll', onScroll)
    window.removeEventListener('keydown', onKey)
  }
}

/**
 * Impresión. El `@media print` de la hoja hace todo el trabajo (una diapositiva,
 * una página); esto solo dispara el diálogo y deja que la página tape con
 * `antesDeImprimir` lo que el CSS no puede (en el dossier, las cifras a medio
 * contar, que si no se congelarían a medias en el PDF).
 */
export function montarImpresion(antesDeImprimir?: () => void): () => void {
  const fijar = antesDeImprimir ?? (() => {})
  window.addEventListener('beforeprint', fijar)

  // El portal pide el PDF con ?print=1. Se lee AQUÍ, en cliente, a propósito:
  // leer searchParams en el servidor volvería dinámica una página que es caché
  // de por vida (revalidate = false) y cada visitante pagaría un render.
  // Al `load` y no al montar: las fuentes de marca entran por <link> con
  // display=swap, e imprimir antes las congelaría en la del sistema.
  // Y solo en escritorio, con el MISMO criterio que el CSS que oculta el botón:
  // en táctil el print del navegador sale roto. El botón ya no existe ahí, pero
  // la URL con `?print=1` sí —del historial, del autocompletado o copiada de la
  // barra de direcciones y compartida— y sin esto abriría el diálogo roto en un
  // móvil, justo lo que ocultar el botón evita.
  const escritorio = window.matchMedia('(hover: hover) and (pointer: fine)').matches
  if (!escritorio || !new URLSearchParams(window.location.search).has('print')) {
    return () => window.removeEventListener('beforeprint', fijar)
  }
  const imprimir = () => window.print()
  if (document.readyState === 'complete') imprimir()
  else window.addEventListener('load', imprimir, { once: true })

  return () => {
    window.removeEventListener('beforeprint', fijar)
    window.removeEventListener('load', imprimir)
  }
}

/**
 * Acuse de lectura: una apertura por sesión contra `/<base>/<token>/visto`.
 *
 * Solo en el enlace REAL. La vista previa en borrador es `/<base>/preview/<id>`
 * y no casa con el patrón, así que no cuenta: mirar tu propio borrador no es que
 * «lo abrió el cliente». Dedupe con sessionStorage para no sumar recargas.
 * Fire-and-forget; si falla, ni se nota.
 *
 * `prefijoClave` es solo la clave de sessionStorage: el dossier lleva la suya
 * desde antes de esta extracción y cambiarla contaría una apertura de más a
 * quien tuviese el deck abierto el día del despliegue.
 */
export function enviarAcuse(base: string, esTokenValido: (t: string) => boolean, prefijoClave = base): void {
  const m = window.location.pathname.match(new RegExp(`^/${base}/([^/]+)$`))
  const token = m?.[1]
  if (!token || !esTokenValido(token)) return
  const clave = `${prefijoClave}-visto-${token}`
  try {
    if (sessionStorage.getItem(clave)) return
    sessionStorage.setItem(clave, '1')
  } catch { /* modo privado sin storage: se contará por carga, aceptable */ }
  const url = `/${base}/${token}/visto`
  try {
    if (navigator.sendBeacon) navigator.sendBeacon(url)
    else fetch(url, { method: 'POST', keepalive: true }).catch(() => {})
  } catch { /* nada que hacer */ }
}
