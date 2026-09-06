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
  /** Rótulo corto, para una ficha en dos columnas. La pregunta entera no sirve
      ahí: la columna de rótulos son sustantivos («Estado», «Teléfono»), y una
      interrogación de seis palabras en versalitas rompe el bloque entero. */
  etiqueta: string
}

export const PREGUNTAS_TAMANO_BASE: PreguntaTamano[] = [
  { clave: 'empresas',     dim: 'empresas',     pregunta: '¿Cuántos negocios o locales llevas?',   cosa: 'negocios', etiqueta: 'Negocios o locales' },
  { clave: 'trabajadores', dim: 'trabajadores', pregunta: '¿Cuántas personas trabajan contigo?',   cosa: 'personas', etiqueta: 'Personas en el equipo' },
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
    ? { clave: 'catalogo', dim: 'servicios', pregunta: '¿Cuántos servicios distintos ofreces?', cosa: 'servicios', etiqueta: 'Servicios distintos' }
    : { clave: 'catalogo', dim: 'productos', pregunta: '¿Cuántos productos distintos vendes?',  cosa: 'productos', etiqueta: 'Productos distintos' }
}

export interface OpcionTamano {
  /** Índice del nivel (posición en el array `niveles`) al que corresponde. */
  nivelIdx: number
  label: string
}

/** Una banda con sus números a la vista, no solo su rótulo. */
export interface BandaTamano extends OpcionTamano {
  /** El mínimo de la banda. */
  desde: number
  /** El máximo, o `null` en la banda abierta («Más de 5»). */
  hasta: number | null
}

/**
 * Las bandas de una dimensión, derivadas de los topes de cada nivel.
 *
 * Se saltan los niveles cuyo tope repite al anterior: una opción que no cambia
 * de nivel es una opción que no pregunta nada. Y si el último nivel tiene tope
 * finito se añade un «Más de X» que apunta a ese mismo último nivel: no hay nada
 * por encima que vender, pero el visitante tiene que poder decir la verdad.
 *
 * Devuelve también los números —y no solo el rótulo— porque el presupuesto los
 * necesita: de la banda que el lead pulsó salen los volúmenes precargados.
 */
export function bandasTamano(niveles: NivelPublico[], dim: string): BandaTamano[] {
  const bandas: BandaTamano[] = []
  let anterior: number | null = null

  niveles.forEach((n, idx) => {
    if (!(dim in n.limites)) return
    const tope = n.limites[dim]
    const desde = (anterior ?? 0) + 1

    if (tope === null) {                                   // sin tope: la última banda
      bandas.push({ nivelIdx: idx, desde, hasta: null, label: anterior === null ? 'Cualquier cantidad' : `Más de ${fmt(anterior)}` })
      anterior = null
      return
    }
    if (anterior !== null && tope <= anterior) return       // no aporta banda nueva
    bandas.push({
      nivelIdx: idx,
      desde,
      hasta: tope,
      label: anterior === null ? `Hasta ${fmt(tope)}` : `Entre ${fmt(desde)} y ${fmt(tope)}`,
    })
    anterior = tope
  })

  // El último nivel tenía tope finito: falta decir qué pasa por encima.
  if (anterior !== null && bandas.length > 0) {
    bandas.push({ nivelIdx: bandas[bandas.length - 1].nivelIdx, desde: anterior + 1, hasta: null, label: `Más de ${fmt(anterior)}` })
  }
  return bandas
}

/** Lo mismo, con lo único que necesita el formulario: a qué nivel apunta y qué se lee. */
export function opcionesTamano(niveles: NivelPublico[], dim: string): OpcionTamano[] {
  return bandasTamano(niveles, dim).map(({ nivelIdx, label }) => ({ nivelIdx, label }))
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

/**
 * Las respuestas del paso de tamaño, en lenguaje humano.
 *
 * `diagnosticos.tamano` guarda ÍNDICES de nivel («2»), que es lo que hace falta
 * para calcular la recomendación y lo único ilegible que hay en la ficha de un
 * lead. Aquí se reconstruye la banda que el visitante leyó y pulsó, con los
 * mismos topes vivos con los que se pintó el formulario.
 *
 * Un índice que ya no tiene banda —porque el tope de ese nivel cambió y dejó de
 * separar— se omite en vez de inventarse una cifra. El nivel recomendado se
 * guardó aparte, en `nivel_rec`, y ese sí es la respuesta congelada.
 *
 * Detalle conocido: si el ÚLTIMO nivel tuviera tope finito, su índice tendría
 * dos bandas («Entre X e Y» y «Más de Y») y aquí se enseñaría la primera. Hoy
 * no pasa —el último nivel es sin tope en las tres dimensiones—, y el nivel
 * recomendado sería el mismo de todas formas.
 */
export interface RespuestaTamano {
  /** La pregunta entera, tal cual se le hizo. Para el correo, que no tiene columnas. */
  pregunta: string
  /** Rótulo corto, para una ficha en dos columnas. */
  etiqueta: string
  /** Solo la banda: «Hasta 3», «Entre 4 y 5», «Más de 5». */
  banda: string
  /** La banda con lo que se cuenta: «Hasta 3 negocios». Se lee sola. */
  respuesta: string
}

export function tamanoComoTexto(
  niveles: NivelPublico[],
  modulosDelSector: string[],
  respuestas: Record<string, number> | null | undefined,
): RespuestaTamano[] {
  if (!respuestas) return []
  const lineas: RespuestaTamano[] = []

  for (const q of [...PREGUNTAS_TAMANO_BASE, preguntaCatalogo(modulosDelSector)]) {
    const idx = respuestas[q.clave]
    if (typeof idx !== 'number') continue
    const banda = opcionesTamano(niveles, q.dim).find((o) => o.nivelIdx === idx)
    if (!banda) continue
    lineas.push({
      pregunta:  q.pregunta,
      etiqueta:  q.etiqueta,
      banda:     banda.label,
      respuesta: `${banda.label} ${q.cosa}`,
    })
  }
  return lineas
}

/**
 * El MÍNIMO que el lead garantizó en cada dimensión, para el presupuesto
 * (`docs/planes/ia-claux-plataforma.md` §6.1). Devuelve claves de `nivel_limites`
 * —`empresas`, `trabajadores`, y `productos` o `servicios` según el sector—, no
 * líneas del presupuesto: esa traducción depende de qué módulos se cotizan y vive
 * en `lib/presupuesto/config`.
 *
 * DOS DECISIONES, y las dos van contra lo que parece obvio:
 *
 * 1. Se toma el SUELO de la banda, no su techo. Estas bandas miden NIVEL, no
 *    volumen: con el tope de trabajadores en 100, «Hasta 100 personas» es lo que
 *    contesta un restaurante de ocho. Poner 100 metería seis horas de migración
 *    inventadas en todos los presupuestos, y con la firma del lead encima.
 * 2. La primera banda NO rellena nada. «Hasta 100» no dice cuántos hay: solo
 *    descarta que sean muchos, y un 1 en el formulario se lee como un dato. Se
 *    rellena únicamente cuando el lead se salió de la banda pequeña («Entre 4 y
 *    5 negocios» → 4), que es cuando su respuesta sí obliga a subir el número.
 *
 * El punto medio —cuántos hay de verdad— es una estimación, y la hace la IA con
 * el resto del diagnóstico delante, declarando su confianza.
 */
export function volumenesDeclarados(
  niveles: NivelPublico[],
  modulosDelSector: string[],
  respuestas: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!respuestas) return {}
  const vol: Record<string, number> = {}

  for (const q of [...PREGUNTAS_TAMANO_BASE, preguntaCatalogo(modulosDelSector)]) {
    const idx = respuestas[q.clave]
    if (typeof idx !== 'number') continue
    const banda = bandasTamano(niveles, q.dim).find((b) => b.nivelIdx === idx)
    if (!banda || banda.desde <= 1) continue
    vol[q.dim] = banda.desde
  }
  return vol
}
