/**
 * Desplazamiento del manual, a duración fija.
 *
 * El `scroll-behavior: smooth` de la base es proporcional a la distancia: el
 * manual entero es UNA página, así que saltar de la cabecera a la última ficha
 * recorría todo el documento y tardaba segundos. Aquí la animación dura lo mismo
 * salte donde salte —cerca o al final—, que es lo que hace utilizable el índice.
 *
 * Vive fuera de los componentes porque lo usan los dos: el buscador (Enter sobre
 * un resultado) y el índice lateral (cualquier enlace del manual).
 */

/** Lo que tarda el salto, vaya donde vaya. Corto: esto es consulta, no paseo. */
const DURACION = 340

/** Debajo de la cabecera fija, o el encabezado queda tapado por ella. */
function holgura(): number {
  const cabecera = document.querySelector<HTMLElement>('.acad-masthead')
  return (cabecera?.offsetHeight ?? 0) + 16
}

/** Salida suave: arranca rápido y frena al llegar. */
const suavizar = (t: number) => 1 - Math.pow(1 - t, 3)

export function desplazarHasta(y: number): void {
  const tope = document.documentElement.scrollHeight - window.innerHeight
  const destino = Math.max(0, Math.min(y, tope))
  const inicio = window.scrollY
  const recorrido = destino - inicio
  if (Math.abs(recorrido) < 2) return

  // `behavior: 'instant'` en cada paso: sin él, el suave de la base se pelea con
  // la animación y el salto se queda a medias.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.scrollTo({ top: destino, behavior: 'instant' })
    return
  }

  const arranque = performance.now()
  const paso = (ahora: number) => {
    const t = Math.min(1, (ahora - arranque) / DURACION)
    window.scrollTo({ top: inicio + recorrido * suavizar(t), behavior: 'instant' })
    if (t < 1) requestAnimationFrame(paso)
  }
  requestAnimationFrame(paso)
}

/** Salta a un ancla del manual y deja la barra de direcciones apuntando ahí. */
export function desplazarAAncla(id: string): boolean {
  const destino = document.getElementById(id)
  if (!destino) return false
  desplazarHasta(destino.getBoundingClientRect().top + window.scrollY - holgura())
  history.replaceState(null, '', `#${id}`)
  return true
}
