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
  const suma = new Map(acumulado.map(t => [t.etiqueta, t.valor]))
  for (const t of nuevos) suma.set(t.etiqueta, (suma.get(t.etiqueta) ?? 0) + t.valor)
  return [...suma.entries()].map(([etiqueta, valor]) => ({ etiqueta, valor }))
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
