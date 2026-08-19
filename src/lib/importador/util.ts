// Utilidades de lectura de celdas del CSV, compartidas por los adaptadores.
// Los archivos vienen de Excel en español: números con coma decimal y punto de
// miles, fechas dd/mm/aaaa, síes y noes escritos de mil formas.
//
// Convención de los `parse*`: `null` = celda vacía · `undefined` = valor
// ilegible (el adaptador decide si eso es un error de fila).

import type { CtxImport, TotalResumen } from './tipos'

/** minúsculas, sin acentos, sin espacios de sobra: para comparar textos. */
export function norm(s: string | null | undefined): string {
  return (s ?? '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // fuera tildes y diéresis
    .replace(/\s+/g, ' ').trim()
}

/**
 * Clave dura de un nombre: además de lo de `norm`, sin puntuación ni espacios.
 * Es el segundo intento al buscar una ficha por su nombre, y es lo que hace que
 * «Comercial S.A.» encuentre a «Comercial SA». Se usa SOLO si la comparación
 * normal no encontró nada y esta encuentra una sola: es tolerante a propósito, y
 * con dos candidatas elegir a ciegas sería peor que no encontrar.
 */
export function claveNombre(s: string | null | undefined): string {
  return norm(s).replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Fragmento aleatorio para ids de negocio con prefijo (`REC-…`, `CATITM-…`,
 * `CATCAT-…`). Mismo formato EXACTO que los helpers `genId`/`corto` de las
 * acciones del portal (8 hex en mayúsculas), para que una ficha creada por el
 * importador sea indistinguible de una creada a mano.
 */
export function idCorto(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
}

/**
 * Distancia de edición (Levenshtein, dos filas). Cuenta cuántas letras hay que
 * cambiar para pasar de un texto a otro: un dedazo («Alquier» por «Alquiler»)
 * queda a 1, y dos palabras distintas quedan lejos.
 */
function distancia(a: string, b: string): number {
  if (a === b)     return 0
  if (!a.length)   return b.length
  if (!b.length)   return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const fila = [i]
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(prev[j] + 1, fila[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = fila
  }
  return prev[b.length]
}

/**
 * Parecido entre dos nombres (0..1) sobre su forma normalizada. Que uno CONTENGA
 * al otro cuenta como parecido alto aunque la distancia sea grande («Alquiler»
 * dentro de «Alquiler del local»): es el caso del nombre abreviado, y por
 * distancia se quedaría fuera. Se exige un mínimo de letras para que un «sa» no
 * se parezca a media lista.
 */
export function parecido(a: string, b: string): number {
  const x = norm(a), y = norm(b)
  if (!x || !y) return 0
  if (x === y)   return 1
  const ratio  = 1 - distancia(x, y) / Math.max(x.length, y.length)
  const dentro = (x.includes(y) || y.includes(x)) && Math.min(x.length, y.length) >= 4
  return dentro ? Math.max(ratio, 0.78) : ratio
}

/**
 * Por debajo de esto dos nombres NO se parecen: ofrecerlo como «¿quisiste
 * decir…?» sería ruido, y el ruido en una lista de sugerencias es peor que la
 * lista vacía —el operador acaba aceptando la primera.
 */
export const UMBRAL_PARECIDO = 0.62

// Formato de miles puro: 1.500 · 12.345 · 1.234.567 (y su gemelo con comas).
// Exige grupos de 3 exactos y que no empiece por cero, así «0.999» sigue siendo
// un decimal y «1.500» son mil quinientos — que es lo que quiere decir un Excel
// en español, el que mandan los clientes.
const MILES_PUNTO = /^-?[1-9]\d{0,2}(\.\d{3})+$/
const MILES_COMA  = /^-?[1-9]\d{0,2}(,\d{3})+$/

/**
 * Número con formato español o inglés: «1.234,56», «1,234.56», «$ 1234.5».
 * Con ambos separadores manda el ÚLTIMO (el otro es de miles). Con uno solo,
 * decide la FORMA: grupos de 3 exactos = miles; si no, decimal.
 */
export function parseNumero(v: string | null | undefined): number | null | undefined {
  const raw = (v ?? '').toString().trim()
  if (!raw) return null
  let s = raw.replace(/[\s ]/g, '')     // espacios, incluido el duro de Excel
    .replace(/^[^\d,.-]+/, '')               // símbolo o código de moneda delante…
    .replace(/[^\d,.-]+$/, '')               // …o detrás ($1.234,56 · 20USD)
  // Estricto a propósito: «10-15» o «1 de 2» son ilegibles, no 10 ni 12. Un
  // importe mal leído en silencio no hay quien lo cace después.
  if (!/^-?[\d.,]+$/.test(s)) return undefined
  const comas = (s.match(/,/g) ?? []).length, puntos = (s.match(/\./g) ?? []).length
  if (comas && puntos) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '')
  } else if (comas) {
    s = MILES_COMA.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if (puntos && MILES_PUNTO.test(s)) {
    s = s.replace(/\./g, '')
  }
  const n = parseFloat(s)
  return isNaN(n) ? undefined : n
}

/** Fecha en dd/mm/aaaa, dd-mm-aaaa o aaaa-mm-dd → 'aaaa-mm-dd'. */
export function parseFecha(v: string | null | undefined): string | null | undefined {
  const raw = (v ?? '').toString().trim()
  if (!raw) return null

  let a: number, m: number, d: number
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  const eur = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (iso)      { a = +iso[1]; m = +iso[2]; d = +iso[3] }
  else if (eur) { d = +eur[1]; m = +eur[2]; a = +eur[3]; if (a < 100) a += a < 70 ? 2000 : 1900 }
  else return undefined

  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined
  const f = new Date(Date.UTC(a, m - 1, d))
  if (f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return undefined   // 31/02
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const SIES = ['si', 'sí', 's', 'x', '1', 'true', 'verdadero', 'yes', 'y']
const NOES = ['no', 'n', '0', 'false', 'falso', '-']

/** Sí/No de una celda: «Sí», «X», «1», «true»… */
export function parseBooleano(v: string | null | undefined): boolean | null | undefined {
  const s = norm(v)
  if (!s) return null
  if (SIES.includes(s)) return true
  if (NOES.includes(s)) return false
  return undefined
}

/**
 * Qué columnas de destino trae de verdad el ARCHIVO en esta fila, a partir del
 * mapa `campo del CSV → columna de la tabla`. Es lo que se escribe al
 * ACTUALIZAR: lo que el archivo no trae, no se toca (ver `Preparado.provistos`).
 * Un valor puesto por un default del asistente no cuenta — los defaults son para
 * crear, no para pisar lo que ya existía.
 */
export function camposProvistos(
  deColumna: Set<string>,
  mapa:      Record<string, string>,
): string[] {
  const out: string[] = ['updated_at']
  for (const [campo, columna] of Object.entries(mapa)) {
    if (deColumna.has(campo)) out.push(columna)
  }
  return out
}

/** Importe con separadores en español, para los totales del dry-run. */
export function formatearImporte(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Suma por clave (moneda, almacén…) → un total por grupo. Sin formatear: el
 * archivo se valida en tandas y estos totales se suman entre ellas (`TotalResumen`).
 */
export function totalesPor(
  filas: Record<string, unknown>[],
  clave: (f: Record<string, unknown>) => string,
  valor: (f: Record<string, unknown>) => number,
  etiqueta: (clave: string) => string,
): TotalResumen[] {
  const suma = new Map<string, number>()
  for (const f of filas) suma.set(clave(f), (suma.get(clave(f)) ?? 0) + valor(f))
  return [...suma.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ etiqueta: etiqueta(k), valor: v }))
}

/** Junta los totales de varias tandas: misma etiqueta, se suman. */
export function fusionarTotales(acumulado: TotalResumen[], nuevos: TotalResumen[]): TotalResumen[] {
  const suma = new Map(acumulado.map(t => [t.etiqueta, t]))
  for (const t of nuevos) {
    const ya = suma.get(t.etiqueta)
    suma.set(t.etiqueta, ya ? { ...ya, valor: ya.valor + t.valor } : t)
  }
  return [...suma.values()]
}

/**
 * ¿Alguien usa ya este registro? Devuelve el motivo de la primera dependencia
 * encontrada, o null si está limpio. Es el guard de `deshacer`: una ficha que ya
 * salió en una factura no se borra aunque la trajera el importador.
 */
export async function primeraDependencia(
  ctx:   CtxImport,
  valor: string,
  refs:  { tabla: string; columna: string; etiqueta: string }[],
): Promise<string | null> {
  for (const r of refs) {
    const { count } = await ctx.db.from(r.tabla)
      .select('*', { count: 'exact', head: true }).eq(r.columna, valor)
    if ((count ?? 0) > 0) return `Ya tiene ${r.etiqueta} asociadas: se queda como está.`
  }
  return null
}

/** Cachea una búsqueda (categoría, proveedor…) durante todo el lote. */
export async function memo<T>(ctx: CtxImport, clave: string, calcular: () => Promise<T>): Promise<T> {
  if (ctx.cache.has(clave)) return ctx.cache.get(clave) as T
  const valor = await calcular()
  ctx.cache.set(clave, valor)
  return valor
}

/** Índice de fichas por nombre, tolerante. Lo devuelve `indicePorNombre`. */
export interface IndiceNombres<T> {
  /**
   * Fichas cuyo nombre coincide con `nombre` (vacío si ninguna). `filtro` acota
   * el ámbito —la empresa, el tipo— ANTES de decidir, para que una ficha de otra
   * empresa no tape a la buena ni haga ambigua la segunda pasada.
   */
  buscar: (nombre: string, filtro?: (ficha: T) => boolean) => T[]
  /**
   * Las que se PARECEN a `nombre` sin coincidir, de más a menos (máx. 5). Es el
   * «¿quisiste decir…?»: cubre el error humano (una letra de menos, dos
   * cambiadas, el singular por el plural) que `buscar` no perdona a propósito.
   */
  sugerir: (nombre: string, filtro?: (ficha: T) => boolean) => T[]
  /** Todas las fichas del índice, para ofrecer la lista completa al operador. */
  todas: (filtro?: (ficha: T) => boolean) => T[]
  /** Apunta una ficha que acaba de crear el propio lote, para las filas siguientes. */
  anotar: (nombre: string, ficha: T) => void
}

/**
 * Índice «nombre → ficha» de una tabla, cargado UNA vez por lote.
 *
 * Sustituye al `ilike('nombre', …)` fila a fila, que rechazaba fichas que sí
 * existían por una tilde, un punto o un espacio doble de Excel —y que además
 * trataba el `_` y el `%` del nombre como comodines—. Emparejar en memoria
 * permite dos pasadas (normal y sin puntuación) y ahorra una consulta por fila.
 */
export async function indicePorNombre<T>(
  ctx:    CtxImport,
  clave:  string,
  cargar: () => Promise<T[]>,
  nombre: (ficha: T) => string,
): Promise<IndiceNombres<T>> {
  return memo(ctx, `idx|${clave}`, async () => {
    const suave = new Map<string, T[]>()
    const duro  = new Map<string, T[]>()
    const lista: T[] = []
    const meter = (mapa: Map<string, T[]>, k: string, ficha: T) => {
      if (!k) return
      const ya = mapa.get(k)
      if (ya) ya.push(ficha)
      else mapa.set(k, [ficha])
    }
    const anotar = (n: string, ficha: T) => {
      meter(suave, norm(n), ficha)
      meter(duro, claveNombre(n), ficha)
      lista.push(ficha)
    }
    for (const ficha of await cargar()) anotar(nombre(ficha), ficha)
    const buscar = (n: string, filtro?: (ficha: T) => boolean) => {
      const pasa = (fichas: T[] | undefined) => (fichas ?? []).filter(f => !filtro || filtro(f))
      const exacto = pasa(suave.get(norm(n)))
      if (exacto.length) return exacto
      const laxo = pasa(duro.get(claveNombre(n)))
      return laxo.length === 1 ? laxo : []
    }
    return {
      anotar,
      // La segunda pasada solo vale si es inequívoca (ver `claveNombre`).
      buscar,
      todas: (filtro?: (ficha: T) => boolean) => lista.filter(f => !filtro || filtro(f)),
      sugerir: (n: string, filtro?: (ficha: T) => boolean) => {
        const ya = new Set(buscar(n, filtro))
        return lista
          .filter(f => !ya.has(f) && (!filtro || filtro(f)))
          .map(f => ({ f, p: parecido(n, nombre(f)) }))
          .filter(x => x.p >= UMBRAL_PARECIDO)
          .sort((a, b) => b.p - a.p)
          .slice(0, 5)
          .map(x => x.f)
      },
    }
  })
}
