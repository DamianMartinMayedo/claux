'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { desplazarAAncla, desplazarHasta } from './desplazar'

/**
 * El comportamiento de LEER el manual, sin nada que pintar.
 *
 * Es lo único que necesita cliente una página de lectura: el resaltado del
 * apartado por el que se va, el plegado del índice (y recordar si se dejó
 * plegado), el salto animado a cualquier ancla, el botón de copiar el enlace de
 * un apartado y la apertura de los apartados `avanzado` cuando se salta dentro
 * de uno o se manda a imprimir.
 *
 * Vive aquí y no en la Academia porque lo montan las DOS superficies: el manual
 * interno (`/academia`) y el centro de ayuda público (`/ayuda`). Es el mismo
 * texto, el mismo índice y las mismas anclas; copiarlo habría dejado la mitad de
 * los arreglos en una sola de las dos.
 *
 * Todo lo demás —texto, índice, sumarios— lo pinta el servidor: sin JS el manual
 * se lee entero y el índice sigue ahí.
 *
 * Los efectos se rehacen al cambiar de página: este componente vive en el layout
 * y no se vuelve a montar, pero el índice y los apartados que consulta sí se
 * renuevan debajo.
 */

/** Ancho por debajo del cual el índice deja de caber al lado y se pliega. */
const ESTRECHO = '(max-width: 960px)'
/** Preferencia de índice plegado/desplegado, solo para pantalla ancha. */
const CLAVE_INDICE = 'claux-academia-indice'
/** Qué grupos del catálogo se dejaron plegados, por tipo y separados por comas. */
const CLAVE_GRUPOS = 'claux-academia-grupos'
/** A partir de aquí ya se ha dejado atrás la cabecera: aparece «volver arriba». */
const UMBRAL_ARRIBA = 700
/**
 * La barra pegada arriba, en cualquiera de las dos superficies: la del manual y
 * la pública, que es la misma de la landing. Es lo que tapa el destino de un
 * salto, así que la medida sale de la que haya, no de una en concreto.
 */
const CABECERA = '.acad-masthead, .ld-header'

export default function Lectura() {
  /** Cambiar de pieza cambia la página bajo este componente: hay que rehacer lo que la consulta. */
  const ruta = usePathname()

  /**
   * Por qué apartado se va leyendo, y si toca enseñar el botón de volver arriba.
   *
   * Se calcula por posición y no con un IntersectionObserver: la banda del
   * observer marcaba activa la última entrada del lote, que en los bordes entre
   * apartados no es la que se está mirando. Aquí la regla es explícita —el
   * último encabezado que ya pasó por debajo de la cabecera—.
   *
   * Solo cuentan los enlaces cuyo destino existe en ESTA página: así el índice
   * puede llevar los apartados de la pieza abierta sin que los de otras estorben.
   */
  useEffect(() => {
    const masthead = document.querySelector<HTMLElement>(CABECERA)
    const arriba = document.querySelector<HTMLElement>('[data-acad-arriba]')
    const sublinks = Array.from(document.querySelectorAll<HTMLElement>('[data-acad-sublink]'))

    let pedido = 0
    let subPrevio: HTMLElement | null = null

    function recalcular() {
      pedido = 0
      const linea = (masthead?.offsetHeight ?? 0) + 24
      // Arriba del todo el botón de volver arriba sobra y tapa texto.
      arriba?.classList.toggle('is-oculto', window.scrollY < UMBRAL_ARRIBA)

      let activoSub: HTMLElement | null = null
      for (const a of sublinks) {
        const destino = document.getElementById(a.dataset.acadSublink!)
        if (destino && destino.getBoundingClientRect().top <= linea) activoSub = a
      }
      if (subPrevio && subPrevio !== activoSub) subPrevio.classList.remove('is-active')
      activoSub?.classList.add('is-active')
      subPrevio = activoSub
    }

    function alMover() {
      if (!pedido) pedido = requestAnimationFrame(recalcular)
    }

    recalcular()
    window.addEventListener('scroll', alMover, { passive: true })
    window.addEventListener('resize', alMover)
    return () => {
      if (pedido) cancelAnimationFrame(pedido)
      window.removeEventListener('scroll', alMover)
      window.removeEventListener('resize', alMover)
    }
  }, [ruta])

  /**
   * Plegado del índice. En pantalla estrecha va delante del texto —desplegado son
   * trece enlaces antes de la primera palabra—, así que ahí empieza cerrado
   * siempre. En pantalla ancha manda quien lee: se pliega desde el tirador y la
   * decisión se recuerda, porque quien viene a leer una ficha larga quiere el
   * ancho entero y no repetir el gesto en cada visita.
   *
   * El estado se aplica desde aquí y no con el atributo en el HTML para que sin
   * JS el índice quede abierto, que es el estado útil.
   */
  useEffect(() => {
    const det = document.querySelector<HTMLDetailsElement>('[data-acad-indice]')
    if (!det) return
    const mq = window.matchMedia(ESTRECHO)

    function preferencia() {
      try { return localStorage.getItem(CLAVE_INDICE) !== 'plegado' } catch { return true }
    }
    const aplicar = () => { det.open = mq.matches ? false : preferencia() }
    const alAlternar = () => {
      // En estrecho el plegado es de la pantalla, no de quien lee: no se guarda.
      if (mq.matches) return
      try { localStorage.setItem(CLAVE_INDICE, det.open ? 'desplegado' : 'plegado') } catch {}
    }
    const alElegir = (e: MouseEvent) => {
      // Elegir un destino en móvil cierra el índice: si no, tapa lo que se acaba
      // de pedir. Corre antes que el salto animado (este listener está en el
      // <details>, el otro en el documento), así que la posición se calcula ya
      // con el índice cerrado y el destino cae donde debe.
      if (mq.matches && (e.target as HTMLElement | null)?.closest('a')) det.open = false
    }

    aplicar()
    mq.addEventListener('change', aplicar)
    det.addEventListener('toggle', alAlternar)
    det.addEventListener('click', alElegir)
    return () => {
      mq.removeEventListener('change', aplicar)
      det.removeEventListener('toggle', alAlternar)
      det.removeEventListener('click', alElegir)
    }
  }, [ruta])

  /**
   * Plegado de cada grupo del catálogo. Quien va a vender un addon no necesita
   * los cinco módulos ocupando la columna, así que cada sección se cierra por su
   * cuenta y la decisión se recuerda.
   *
   * Un grupo plegado NO se reabre solo al pasar leyendo por él: si se cerró fue
   * a propósito, y que se abriera al hacer scroll sería justo lo contrario de lo
   * que se pidió.
   */
  useEffect(() => {
    const grupos = Array.from(document.querySelectorAll<HTMLDetailsElement>('[data-acad-grupo]'))
    if (grupos.length === 0) return

    let plegados: string[] = []
    try { plegados = (localStorage.getItem(CLAVE_GRUPOS) ?? '').split(',').filter(Boolean) } catch {}
    for (const g of grupos) g.open = !plegados.includes(g.dataset.acadGrupo!)

    const guardar = () => {
      const cerrados = grupos.filter(g => !g.open).map(g => g.dataset.acadGrupo!)
      try { localStorage.setItem(CLAVE_GRUPOS, cerrados.join(',')) } catch {}
    }
    for (const g of grupos) g.addEventListener('toggle', guardar)
    return () => { for (const g of grupos) g.removeEventListener('toggle', guardar) }
  }, [ruta])

  /**
   * Todo salto dentro del manual, animado a duración fija. Un solo listener para
   * los cientos de anclas de la página: índice, sumarios de ficha, saltos entre
   * fichas y volver arriba.
   */
  useEffect(() => {
    function alPulsar(e: MouseEvent) {
      // Abrir en otra pestaña, con botón central o con modificador sigue siendo
      // cosa del navegador.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="#"]')
      if (!a?.closest('.acad-root')) return

      const id = a.getAttribute('href')!.slice(1)
      if (!id) { e.preventDefault(); desplazarHasta(0); return }
      if (desplazarAAncla(id)) e.preventDefault()
    }
    document.addEventListener('click', alPulsar)
    return () => document.removeEventListener('click', alPulsar)
  }, [])

  /** Copiar el enlace de un apartado. Un solo listener para los ~150 botones. */
  useEffect(() => {
    let quitar: ReturnType<typeof setTimeout> | undefined
    function alPulsar(e: MouseEvent) {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-acad-copy]')
      if (!btn) return
      // Un apartado avanzado lleva su encabezado dentro del <summary>: sin esto,
      // copiar el enlace plegaría el apartado que se acaba de compartir.
      e.preventDefault()
      const id = btn.dataset.acadCopy!
      // La barra de direcciones queda apuntando al apartado aunque el
      // portapapeles no esté disponible: así el enlace se puede copiar a mano.
      history.replaceState(null, '', `#${id}`)
      const portapapeles = navigator.clipboard
      if (!portapapeles) return
      portapapeles.writeText(`${location.origin}${location.pathname}#${id}`).then(() => {
        btn.classList.add('is-copiado')
        clearTimeout(quitar)
        quitar = setTimeout(() => btn.classList.remove('is-copiado'), 1600)
      }).catch(() => {})
    }
    document.addEventListener('click', alPulsar)
    return () => {
      clearTimeout(quitar)
      document.removeEventListener('click', alPulsar)
    }
  }, [])

  /**
   * Un apartado `avanzado` se pliega, y a un apartado plegado se salta igual:
   * desde el índice, desde el buscador, desde un enlace copiado o desde la URL
   * al entrar. Si no se abre antes del salto, el destino existe pero no se ve, y
   * parece que el enlace está roto.
   *
   * Al imprimir se abren TODOS y se dejan como estaban: en papel no hay nada que
   * desplegar, y el PDF tiene que salir entero. Esto no lo puede hacer el CSS.
   */
  useEffect(() => {
    function abrirQueContiene(id: string) {
      const destino = document.getElementById(id)
      let det = destino?.closest<HTMLDetailsElement>('details.acad-avanzado')
      while (det) {
        det.open = true
        det = det.parentElement?.closest<HTMLDetailsElement>('details.acad-avanzado') ?? null
      }
    }

    function alPulsar(e: MouseEvent) {
      const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="#"]')
      const id = a?.getAttribute('href')?.slice(1)
      // Antes que el listener del salto (este va en captura), para que la
      // posición del destino se mida ya con el apartado abierto.
      if (id) abrirQueContiene(id)
    }

    const alHash = () => { if (location.hash.length > 1) abrirQueContiene(location.hash.slice(1)) }
    alHash()

    let plegados: HTMLDetailsElement[] = []
    const antesDeImprimir = () => {
      plegados = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.acad-avanzado'))
        .filter(d => !d.open)
      for (const d of plegados) d.open = true
    }
    const despuesDeImprimir = () => {
      for (const d of plegados) d.open = false
      plegados = []
    }

    document.addEventListener('click', alPulsar, true)
    window.addEventListener('hashchange', alHash)
    window.addEventListener('beforeprint', antesDeImprimir)
    window.addEventListener('afterprint', despuesDeImprimir)
    return () => {
      document.removeEventListener('click', alPulsar, true)
      window.removeEventListener('hashchange', alHash)
      window.removeEventListener('beforeprint', antesDeImprimir)
      window.removeEventListener('afterprint', despuesDeImprimir)
    }
  }, [ruta])

  return null
}
