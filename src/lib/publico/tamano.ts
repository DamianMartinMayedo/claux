// ────────────────────────────────────────────────────────────────────────────
// «¿De qué tamaño es tu negocio?» — el paso del diagnóstico que decide NIVEL.
//
// Plan: docs/planes/niveles-comerciales.md §11.2 (D12). El diagnóstico deja de
// recomendar solo módulos y pasa a recomendar módulos **+ nivel**, sin precio.
//
// LAS OPCIONES NO ESTÁN ESCRITAS A MANO. Se derivan de los límites vivos de
// `nivel_limites`: con topes 3 / 5 / sin tope, las opciones salen «Hasta 3»,
// «Entre 4 y 5» y «Más de 5». Si mañana el dueño sube el tope de Inicial a 4
// desde /admin/niveles, la pregunta se reescribe sola. Escribir las bandas a
// mano habría creado un segundo sitio donde vive el mismo número, y ese segundo
// sitio se queda viejo en silencio: el visitante vería una banda y el sistema
// aplicaría otra.
//
// Este fichero es puro (sin imports de servidor): lo usa el formulario cliente.
// ────────────────────────────────────────────────────────────────────────────

import type { NivelPublico } from './tipos'

/**
 * Las tres preguntas. Tres y no nueve: el diagnóstico se vende como «2 minutos»
 * y estas tres bastan para separar los niveles —el resto de dimensiones escalan
 * con ellas—. En lenguaje de dueño de negocio, no en nombres de dimensión.
 *
 * `dim` es la dimensión de `nivel_limites` contra la que se compara. La del
 * catálogo se elige según el sector (ver `dimCatalogo`): un salón de belleza
 * vende servicios, no productos, y son dos topes distintos.
 */
export interface PreguntaTamano {
  clave: string
  dim: string
  pregunta: string
  /** Qué se está contando, para la etiqueta de cada opción («… negocios»). */
  cosa: string
}

export const PREGUNTAS_TAMANO_BASE: PreguntaTamano[] = [
  { clave: 'empresas',     dim: 'empresas',     pregunta: '¿Cuántos negocios o locales llevas?',   cosa: 'negocios' },
  { clave: 'trabajadores', dim: 'trabajadores', pregunta: '¿Cuántas personas trabajan contigo?',   cosa: 'personas' },
]

/**
 * La pregunta del catálogo, con la dimensión que le toca al sector. `products`
 * guarda productos y servicios en la misma tabla pero son DOS topes distintos
 * (200 vs 50 en Inicial): preguntar por «productos» a una peluquería y medirla
 * contra el tope de productos la deja en Inicial cuando ya no cabe.
 */
export function preguntaCatalogo(modulosDelSector: string[]): PreguntaTamano {
  const soloServicios = modulosDelSector.includes('servicios') && !modulosDelSector.includes('inventario')
  return soloServicios
    ? { clave: 'catalogo', dim: 'servicios', pregunta: '¿Cuántos servicios distintos ofreces?', cosa: 'servicios' }
    : { clave: 'catalogo', dim: 'productos', pregunta: '¿Cuántos productos distintos vendes?',  cosa: 'productos' }
}

export interface OpcionTamano {
  /** Índice del nivel (posición en el array `niveles`) al que corresponde. */
  nivelIdx: number
  label: string
}

/**
 * Las bandas de una dimensión, derivadas de los topes de cada nivel.
 *
 * Se saltan los niveles cuyo tope repite al anterior: una opción que no cambia
 * de nivel es una opción que no pregunta nada. Y si el último nivel tiene tope
 * finito se añade un «Más de X» que apunta a ese mismo último nivel: no hay nada
 * por encima que vender, pero el visitante tiene que poder decir la verdad.
 */
export function opcionesTamano(niveles: NivelPublico[], dim: string): OpcionTamano[] {
  const opciones: OpcionTamano[] = []
  let anterior: number | null = null

  niveles.forEach((n, idx) => {
    if (!(dim in n.limites)) return
    const tope = n.limites[dim]

    if (tope === null) {                                   // sin tope: la última banda
      opciones.push({ nivelIdx: idx, label: anterior === null ? 'Cualquier cantidad' : `Más de ${fmt(anterior)}` })
      anterior = null
      return
    }
    if (anterior !== null && tope <= anterior) return       // no aporta banda nueva
    opciones.push({
      nivelIdx: idx,
      label: anterior === null ? `Hasta ${fmt(tope)}` : `Entre ${fmt(anterior + 1)} y ${fmt(tope)}`,
    })
    anterior = tope
  })

  // El último nivel tenía tope finito: falta decir qué pasa por encima.
  if (anterior !== null && opciones.length > 0) {
    opciones.push({ nivelIdx: opciones[opciones.length - 1].nivelIdx, label: `Más de ${fmt(anterior)}` })
  }
  return opciones
}

function fmt(n: number): string {
  return n.toLocaleString('es-ES')
}

/**
 * El nivel recomendado: el más alto que exige alguna de las respuestas. Basta
 * con pasarse en UNA dimensión para necesitar el nivel de arriba — es la misma
 * regla que aplica el portal cuando bloquea añadir.
 *
 * Devuelve `null` si no hay niveles cargados o no se respondió nada, que es lo
 * que hace que el informe se calle en vez de inventar una recomendación.
 */
export function nivelRecomendado(
  niveles: NivelPublico[],
  respuestas: Record<string, number | undefined>,
): NivelPublico | null {
  const indices = Object.values(respuestas).filter((v): v is number => typeof v === 'number')
  if (niveles.length === 0 || indices.length === 0) return null
  return niveles[Math.min(Math.max(...indices), niveles.length - 1)] ?? null
}
