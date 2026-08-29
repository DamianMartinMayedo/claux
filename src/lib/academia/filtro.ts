import type { Audiencia, Capa } from './capas'

/**
 * El filtro que convierte el manual interno en lo que ve cada capa.
 *
 * Trabaja sobre el Markdown, no sobre el HTML ya pintado, porque lo que se
 * quita tiene que desaparecer también de los sumarios, del índice lateral, del
 * buscador y de la cuenta de apartados: si se ocultara con CSS seguiría estando
 * en la página, y una vista «como vendedor» que trae el margen escondido en el
 * HTML no vale para nada.
 *
 * La regla es de HERENCIA por sección:
 *  · un apartado con etiqueta se va entero —con todo lo que cuelga de él— si su
 *    audiencia no entra en la capa;
 *  · un encabezado SIN etiqueta (los bloques «A — Qué es», «5 — Objeciones») no
 *    decide nada por sí mismo: sobrevive mientras le quede algo debajo. Así, al
 *    caerse los dos apartados de «C — Venderlo» no queda un rótulo huérfano.
 *
 * La segunda mitad de la etiqueta —la PROFUNDIDAD— no quita nada: no es una
 * frontera, es cuánto baja el apartado. Se devuelve aparte para que el
 * renderizador pueda plegarla, porque aquí ya no se puede leer: fuera de la capa
 * interna la línea `> etiquetas:` se borra del texto.
 */

const ETIQUETAS = /^>\s*etiquetas:\s*(.*)$/i

type Nodo = {
  nivel: number
  /** Las líneas propias: el encabezado y su texto hasta el siguiente. */
  lineas: string[]
  hijos: Nodo[]
  /** La audiencia de su línea `> etiquetas:`, si la tiene. */
  audiencia?: Audiencia
  /** ¿Su etiqueta dice `avanzado`? Solo se anota el que sí. */
  avanzado?: boolean
}

export type Filtrado = {
  /** El Markdown que sobrevive. Cadena vacía = esta pieza no entra en la capa. */
  texto: string
  /** Cuántos apartados etiquetados quedan: lo que esa capa puede leer de verdad. */
  etiquetados: number
  /** Los encabezados marcados `avanzado`, tal cual están escritos. */
  avanzados: string[]
}

/** El árbol de secciones del documento, por nivel de encabezado. */
function trocear(md: string): Nodo {
  const raiz: Nodo = { nivel: 0, lineas: [], hijos: [] }
  const pila: Nodo[] = [raiz]
  let enCerca = false

  for (const linea of md.replace(/\r\n/g, '\n').split('\n')) {
    const recortada = linea.trim()
    // Dentro de un diagrama no hay encabezados que valgan.
    if (/^```/.test(recortada)) {
      if (!/^```+.*```$/.test(recortada)) enCerca = !enCerca
      pila[pila.length - 1].lineas.push(linea)
      continue
    }

    const he = enCerca ? null : /^(#{1,6})\s+/.exec(recortada)
    if (he) {
      const nivel = he[1].length
      while (pila.length > 1 && pila[pila.length - 1].nivel >= nivel) pila.pop()
      const nodo: Nodo = { nivel, lineas: [linea], hijos: [] }
      pila[pila.length - 1].hijos.push(nodo)
      pila.push(nodo)
      continue
    }

    const actual = pila[pila.length - 1]
    actual.lineas.push(linea)
    const etq = enCerca ? null : ETIQUETAS.exec(recortada)
    if (etq && !actual.audiencia) {
      const partes = etq[1].split('·').map(s => s.trim().toLowerCase())
      actual.audiencia = partes[0] as Audiencia
      if (partes[1] === 'avanzado') actual.avanzado = true
    }
  }

  return raiz
}

function podar(n: Nodo, permitidas: Set<Audiencia>): Nodo | null {
  // Con etiqueta propia decide ella, y arrastra todo lo que tenga debajo.
  if (n.audiencia && !permitidas.has(n.audiencia)) return null

  const hijos = n.hijos.map(h => podar(h, permitidas)).filter((h): h is Nodo => h !== null)
  if (n.audiencia || n.nivel === 0) return { ...n, hijos }

  // Sin etiqueta: vale mientras le quede algo, o si nunca tuvo hijos que perder
  // (es texto suelto que cuelga de un apartado ya aprobado más arriba).
  if (hijos.length > 0 || n.hijos.length === 0) return { ...n, hijos }
  return null
}

function aTexto(n: Nodo, salida: string[]): void {
  salida.push(...n.lineas)
  for (const h of n.hijos) aTexto(h, salida)
}

function contar(n: Nodo): number {
  return (n.audiencia ? 1 : 0) + n.hijos.reduce((t, h) => t + contar(h), 0)
}

/** El texto de su encabezado, si el nodo es uno. La raíz y el texto suelto, no. */
function encabezadoDe(n: Nodo): string | null {
  const he = n.lineas[0] ? /^\s*#{1,6}\s+(.*)$/.exec(n.lineas[0].trim()) : null
  return he ? he[1].trim() : null
}

/**
 * Los encabezados `avanzado` que sobreviven a la poda, en orden de lectura.
 *
 * La marca se HEREDA y no se repite: dentro de un apartado ya marcado, los suyos
 * no vuelven a marcarse. Sin esto la Parte V —que es avanzada entera— salía como
 * dieciocho apartados avanzados seguidos, que es decir dieciocho veces lo mismo.
 */
function recogerAvanzados(n: Nodo, salida: string[]): void {
  if (n.avanzado) {
    const texto = encabezadoDe(n)
    if (texto) { salida.push(texto); return }
  }
  for (const h of n.hijos) recogerAvanzados(h, salida)
}

export function filtrarPorCapa(md: string, capa: Capa): Filtrado {
  const permitidas = new Set(capa.ve)
  const podado = podar(trocear(md), permitidas)
  if (!podado) return { texto: '', etiquetados: 0, avanzados: [] }

  const lineas: string[] = []
  aTexto(podado, lineas)

  // Fuera de la vista interna las etiquetas sobran: son metadatos nuestros, y la
  // gracia de mirar «como vendedor» es ver exactamente su página, no la nuestra
  // con cosas tachadas.
  const visible = capa.clave === 'interna'
    ? lineas
    : lineas.filter(l => !ETIQUETAS.test(l.trim()))

  const texto = visible.join('\n').trim()
  const avanzados: string[] = []
  recogerAvanzados(podado, avanzados)
  return { texto, etiquetados: contar(podado), avanzados }
}
