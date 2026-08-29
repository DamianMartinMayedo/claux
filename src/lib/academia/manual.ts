import 'server-only'
import { cache } from 'react'
import { ORDEN, type Pieza } from './piezas'
import { leerDoc, cuerpoFicha } from './contenido'
import { preciosDelCatalogo, type PrecioCatalogo } from './precios'
import { encabezados, type Encabezado } from './indice'
import { filtrarPorCapa } from './filtro'
import { capaPorClave, type ClaveCapa } from './capas'

/**
 * El manual entero ya leído: texto, sumarios y datos en vivo del catálogo.
 *
 * Lo necesitan a la vez el layout (índice lateral y buscador, que son globales)
 * y la página de la pieza que se está leyendo. Va envuelto en `cache()` de React
 * para que las dos compartan UNA sola lectura y UNA sola consulta por petición,
 * en lugar de repetirlas.
 *
 * Sale ya FILTRADO por la capa con la que se está mirando, y no solo el texto:
 * los sumarios, la cuenta de apartados y los minutos se calculan sobre lo que
 * queda. Así una vista «como vendedor» no puede enseñar de más por un sitio que
 * se olvidó de filtrar —el índice lateral, el buscador— ni mentir en la cuenta.
 */

export type PiezaLeida = Pieza & {
  /** Nombre visible: en las fichas manda el del catálogo, que es el que ve el cliente. */
  nombre: string
  /** ¿Tiene texto escrito? `false` = ficha todavía en preparación. */
  escrita: boolean
  /**
   * Lo que se pinta, ya filtrado. `null` = o no está escrita, o no queda nada
   * de ella en esta capa (la Parte III entera desaparece para el cliente).
   */
  cuerpo: string | null
  /** Apartados etiquetados que sobreviven: lo que esta capa puede leer de verdad. */
  etiquetados: number
  /** Encabezados marcados `avanzado`: los que el lector puede plegar. */
  avanzados: string[]
  /** Precios y estado en vivo, solo si la pieza está en `modulos_catalogo`. */
  precio?: PrecioCatalogo
  /** Los bloques A/B/C/Interno: lo que cuelga de la pieza en el índice lateral. */
  bloques: Encabezado[]
  /** Los apartados numerados: la fila «En esta ficha». */
  apartados: Encabezado[]
  /** Minutos de lectura, redondeados. Cuánto cuesta leerla, no cuánto ocupa. */
  minutos: number
}

/**
 * Prosa técnica en español, leída con atención y parando en los diagramas. Es
 * una estimación honesta, no un cronómetro: sirve para decidir si esta pieza
 * entra antes de la visita de las diez, que es la pregunta real.
 */
const PALABRAS_POR_MINUTO = 200

function minutosDe(texto: string | null): number {
  if (!texto) return 0
  const palabras = texto.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(palabras / PALABRAS_POR_MINUTO))
}

/** Una duración en minutos, dicha como la diría una persona. */
export function duracion(minutos: number): string {
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`
}

export const leerManual = cache(async (clave: ClaveCapa): Promise<PiezaLeida[]> => {
  const capa = capaPorClave(clave)
  // Los precios y el nombre comercial salen del catálogo del sistema, no de este
  // repositorio: un manual de ventas con un precio viejo es peor que uno incompleto.
  const [precios, textos] = await Promise.all([
    preciosDelCatalogo(),
    Promise.all(ORDEN.map(p => leerDoc(p.archivo))),
  ])

  return ORDEN.map((p, i) => {
    const md = textos[i]
    const bruto = md ? (p.ficha ? cuerpoFicha(md) : md) : null
    const filtrado = bruto ? filtrarPorCapa(bruto, capa) : null
    const cuerpo = filtrado?.texto || null
    const precio = p.ficha?.clave ? precios.modulos[p.ficha.clave] : undefined
    return {
      ...p,
      nombre: precio?.nombre ?? p.titulo,
      escrita: md !== null,
      cuerpo,
      etiquetados: filtrado?.etiquetados ?? 0,
      avanzados: filtrado?.avanzados ?? [],
      precio,
      bloques: cuerpo ? encabezados(cuerpo, 2, p.slug) : [],
      apartados: cuerpo ? encabezados(cuerpo, 3, p.slug) : [],
      minutos: minutosDe(cuerpo),
    }
  })
})
