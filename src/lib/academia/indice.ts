import { anclaEncabezado } from './slug'

/**
 * Índice de búsqueda del manual: una entrada por apartado (cada encabezado con
 * el texto que cuelga de él). Se construye en el servidor a partir del mismo
 * Markdown que se pinta, y viaja entero al navegador.
 *
 * Va completo al cliente a propósito: cada pieza es una página, pero el buscador
 * las abarca todas y responde al teclear —en conexión mala, buscar tiene que
 * contestar al momento, no cuando vuelva la red—.
 */

export type EntradaIndice = {
  /** Ancla a la que salta el resultado. */
  id: string
  /** Pieza (página) en la que vive el apartado: de aquí sale su URL. */
  pieza: string
  /** Ficha o parte a la que pertenece (para situar el resultado). */
  seccion: string
  /** Encabezado del apartado. */
  titulo: string
  /** Texto plano del apartado, para buscar y para el extracto. */
  texto: string
}

/** Quita el marcado en línea: queda el texto que el usuario lee. */
function aTextoPlano(linea: string): string {
  return linea
    .replace(/\[([^\]]+?)\]\([^)]+?\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normaliza para comparar: sin acentos ni mayúsculas. */
export function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** Un encabezado del documento, con el ancla a la que se salta. */
export type Encabezado = { id: string; texto: string }

/**
 * Los encabezados de UN nivel, en orden. De aquí salen las dos ayudas de
 * navegación —los bloques (H2) que cuelgan de cada ficha en el índice lateral y
 * los apartados (H3) de la fila «En esta ficha»—, sacadas del mismo Markdown que
 * se pinta: un apartado nuevo aparece en las dos sin tocar nada más.
 */
export function encabezados(md: string, nivel: 2 | 3, slug?: string): Encabezado[] {
  const salida: Encabezado[] = []
  const patron = new RegExp(`^#{${nivel}}\\s+(.*)$`)
  let enCerca = false

  for (const cruda of md.replace(/\r\n/g, '\n').split('\n')) {
    const linea = cruda.trim()
    // Dentro de un diagrama no hay encabezados que valgan.
    if (/^```/.test(linea)) {
      if (!/^```+.*```$/.test(linea)) enCerca = !enCerca
      continue
    }
    if (enCerca) continue
    const he = patron.exec(linea)
    if (!he) continue
    const texto = aTextoPlano(he[1])
    salida.push({ id: anclaEncabezado(texto, slug), texto })
  }

  return salida
}

/** Trocea un documento en apartados por sus encabezados. */
function indexarDocumento(md: string, seccion: string, slug?: string): EntradaIndice[] {
  const entradas: EntradaIndice[] = []
  let actual: EntradaIndice | null = null
  let enCerca = false

  for (const cruda of md.replace(/\r\n/g, '\n').split('\n')) {
    const linea = cruda.trim()

    // Los bloques cercados (diagramas) no son texto buscable.
    if (/^```/.test(linea)) {
      if (!/^```+.*```$/.test(linea)) enCerca = !enCerca
      continue
    }
    if (enCerca) continue

    const he = /^(#{1,4})\s+(.*)$/.exec(linea)
    if (he) {
      if (actual && actual.texto) entradas.push(actual)
      const titulo = aTextoPlano(he[2])
      actual = { id: anclaEncabezado(titulo, slug), pieza: slug ?? '', seccion, titulo, texto: '' }
      continue
    }

    if (!actual) continue
    if (/^>\s*etiquetas:/i.test(linea)) continue // los chips no son contenido
    if (/^(---+|\|)/.test(linea)) continue        // reglas y tablas
    const texto = aTextoPlano(linea.replace(/^>\s?/, '').replace(/^\s*([-*]|\d+\.)\s+/, ''))
    if (texto) actual.texto += (actual.texto ? ' ' : '') + texto
  }
  if (actual && actual.texto) entradas.push(actual)

  return entradas
}

export function construirIndice(
  docs: { md: string; seccion: string; slug?: string }[],
): EntradaIndice[] {
  return docs.flatMap(d => indexarDocumento(d.md, d.seccion, d.slug))
}
