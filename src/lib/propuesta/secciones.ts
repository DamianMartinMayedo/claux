// ── Las secciones de la propuesta, y cómo se ocultan y se reordenan ─────────
//
// La plantilla tiene dieciséis diapositivas, pero no son dieciséis fijas: AUGE
// entregó catorce y Fangio diecisiete, de la misma plantilla, y los números del
// pie de AUGE van 1·2·3·4·5·10·6·8·11·12·13·14·15·16. Clau no oculta: BORRA y
// MUEVE. Así que aquí no hay una lista de sitios, hay un orden por defecto y dos
// listas que lo modifican (`secciones_ocultas`, `secciones_orden`).
//
// Dos de las secciones se REPITEN: «Pensado para tu negocio» sale una vez por
// cada tres módulos (Fangio la lleva dos veces, con seis módulos) y las capturas
// una por imagen. Sus claves llevan sufijo —`pensado:1`, `captura:12`— para que
// se puedan ocultar y mover una a una, que es lo que hizo AUGE al meter la
// captura de Tesorería antes que la de Contabilidad.

/**
 * A partir de aquí una captura es sospechosa: la interfaz cambia cada semana y
 * enseñar una pantalla que ya no existe es peor que no enseñar ninguna. Vive
 * aquí y no en cada vista porque el umbral lo miran tres pantallas —la
 * biblioteca, el listado de propuestas y la consulta que las cuenta— y con una
 * copia por sitio bastaba con tocar una para que dejaran de decir lo mismo.
 */
export const DIAS_CADUCA_CAPTURA = 90

/** Las secciones base, en el orden de la plantilla. */
export const SECCIONES = [
  { clave: 'portada',           etiqueta: 'Portada',                 fija: true },
  { clave: 'entendimos',        etiqueta: 'Lo que entendimos',       fija: false },
  { clave: 'que_es',            etiqueta: '¿Qué es CLAUX?',          fija: false },
  { clave: 'problema',          etiqueta: 'El problema que resuelve', fija: false },
  { clave: 'pensado',           etiqueta: 'Pensado para tu negocio', fija: false },
  { clave: 'capturas',          etiqueta: 'Los módulos por dentro',  fija: false },
  { clave: 'precios',           etiqueta: 'Precios',                 fija: false },
  { clave: 'tu_propuesta',      etiqueta: 'Tu propuesta',            fija: false },
  { clave: 'como_se_configura', etiqueta: 'Cómo se configura',       fija: false },
  { clave: 'confianza',         etiqueta: 'Por qué confiar en CLAUX', fija: false },
  { clave: 'empecemos',         etiqueta: 'Empecemos',               fija: true },
] as const

export type ClaveSeccion = (typeof SECCIONES)[number]['clave']

export const ORDEN_POR_DEFECTO: string[] = SECCIONES.map(s => s.clave)

/** La portada y el cierre no se quitan: una presentación sin portada no es una
 *  presentación, y sin el contacto del comercial no se puede contestar. */
export const NO_OCULTABLES: string[] = SECCIONES.filter(s => s.fija).map(s => s.clave)

/** `pensado:2` → `pensado`; `captura:12` → `capturas`. */
export function seccionDe(clave: string): string {
  if (clave.startsWith('captura:')) return 'capturas'
  const i = clave.indexOf(':')
  return i === -1 ? clave : clave.slice(0, i)
}

/**
 * ¿Se pinta esta diapositiva? Oculta vale tanto por la clave exacta
 * (`captura:12`, una imagen concreta) como por su sección (`capturas`, todas).
 */
export function estaOculta(clave: string, ocultas: readonly string[]): boolean {
  if (NO_OCULTABLES.includes(clave)) return false
  return ocultas.includes(clave) || ocultas.includes(seccionDe(clave))
}

/**
 * Aplica el orden guardado. Una diapositiva se coloca por su clave exacta si el
 * orden la nombra (`captura:12`, para mover UNA imagen) y, si no, por su sección
 * (`capturas`, que las lleva todas juntas). Lo que el orden no nombra va detrás,
 * en el orden natural, y el desempate dentro de un mismo puesto también.
 *
 * Ese respaldo no es teórico: el orden se guarda con las claves de un momento
 * dado y las capturas se dan de alta después. Sin él, subir una imagen nueva la
 * dejaría fuera de la presentación sin que nadie lo note.
 */
export function ordenar<T extends { clave: string }>(slides: T[], orden: readonly string[]): T[] {
  if (orden.length === 0) return slides
  const pos = new Map(orden.map((c, i) => [c, i]))
  const rango = (c: string) => pos.get(c) ?? pos.get(seccionDe(c)) ?? Number.MAX_SAFE_INTEGER
  return slides
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rango(a.s.clave) - rango(b.s.clave) || a.i - b.i)
    .map(x => x.s)
}

/** Cuántos módulos caben en una diapositiva de «Pensado para tu negocio». */
/**
 * Las claves de `propuesta_textos` que el editor puede escribir, aparte de los
 * `modulo:<clave>` (que son tantos como módulos y se validan por el prefijo).
 *
 * Es una LISTA BLANCA y no una comprobación de formato: lo que llega del editor
 * es un objeto de claves libres, y sin filtro una clave con una errata se
 * guardaría tan campante y no se leería nunca — el comercial escribiría el texto,
 * vería «guardado» y la diapositiva seguiría saliendo con lo prellenado.
 */
export const CLAVES_TEXTO: readonly string[] = [
  'entendimos_1', 'entendimos_2', 'entendimos_3', 'entendimos_4',
  'hoy_1', 'hoy_2', 'hoy_3',
  'pago',
]

export const MODULOS_POR_PAGINA = 3
