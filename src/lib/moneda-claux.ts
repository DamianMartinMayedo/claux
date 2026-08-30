// ─────────────────────────────────────────────────────────────────────────────
// La moneda en la que CLAUX cobra a SUS clientes: dólar o euro.
//
// Plan: docs/planes/precios-en-euros.md · migración 225.
//
// NO CONFUNDIR con la multimoneda del producto (`lib/monedas-catalogo.ts`, la
// tabla `monedas` del tenant): aquella es el dinero del NEGOCIO del cliente y la
// lleva él, con sus pares de tasa. Esta es el dinero de CLAUX, tiene exactamente
// dos valores y no cotiza: el precio en euros es un precio propio, tecleado, no
// una conversión del de dólares. Ese es el punto de todo esto — con la tasa del
// día, lo facturado y lo pagado no coincidían nunca.
//
// El formato es `$35.00` / `€35.00`, con el símbolo delante en las dos. En
// castellano el euro va detrás («35,00 €»), pero una tabla que mezcla las dos
// convenciones en columnas contiguas se lee peor que una que elige una: lo que
// tiene que saltar a la vista es el símbolo, y va donde el ojo ya lo busca.
// ─────────────────────────────────────────────────────────────────────────────

export type MonedaClaux = 'USD' | 'EUR'

/** En el orden en el que se ofrecen. El dólar primero: es la moneda por defecto. */
export const MONEDAS_CLAUX: readonly MonedaClaux[] = ['USD', 'EUR'] as const

export const SIMBOLO_CLAUX: Record<MonedaClaux, string> = { USD: '$', EUR: '€' }

/** Nombre para los textos legales («en dólares estadounidenses (USD)»). */
export const NOMBRE_MONEDA_CLAUX: Record<MonedaClaux, string> = {
  USD: 'dólares estadounidenses',
  EUR: 'euros',
}

/**
 * Cualquier cosa → una moneda válida. Por defecto USD, que es lo que había antes
 * de la 225 y lo que sigue diciendo el `default` de las tres columnas nuevas.
 */
export function normalizarMonedaClaux(v: unknown): MonedaClaux {
  return String(v ?? '').trim().toUpperCase() === 'EUR' ? 'EUR' : 'USD'
}

/**
 * Un importe de CLAUX, con su símbolo. **Es el único formateador**: antes había
 * ocho copias de `` `$${n.toFixed(2)}` `` repartidas por el admin, el portal y el
 * PDF, y cada una habría que acordarse de cambiarla.
 */
export function importeClaux(
  n: number | string | null | undefined, moneda: unknown, decimales = 2,
): string {
  return `${SIMBOLO_CLAUX[normalizarMonedaClaux(moneda)]}${(Number(n) || 0).toFixed(decimales)}`
}

/**
 * Totales por moneda, SIN convertir. $100 y €100 no hacen 200 de nada: son dos
 * cifras y se enseñan como dos. Lo usan el dashboard (MRR y cobros del mes), la
 * ficha del cliente y las métricas, que antes sumaban una sola columna.
 */
export function totalPorMoneda<T>(
  filas: readonly T[],
  moneda: (f: T) => unknown,
  importe: (f: T) => number | string | null | undefined,
): Record<MonedaClaux, number> {
  const acc: Record<MonedaClaux, number> = { USD: 0, EUR: 0 }
  for (const f of filas) acc[normalizarMonedaClaux(moneda(f))] += Number(importe(f)) || 0
  return acc
}

/**
 * Los totales de `totalPorMoneda`, escritos: «$1200.00 · €340.00». Solo salen las
 * monedas con dinero —quien solo factura en dólares no tiene por qué ver un «€0.00»
 * al lado—, y si no hay ninguna sale un cero en `vacio`. Orden fijo (el de
 * `MONEDAS_CLAUX`) y no por importe: una cifra que cambia de sitio al mirarla otro
 * día se lee mal.
 */
export function importesPorMoneda(
  totales: Record<MonedaClaux, number>, vacio: MonedaClaux = 'USD', decimales = 2,
): string {
  const conDinero = MONEDAS_CLAUX.filter(m => totales[m] !== 0)
  const usar = conDinero.length > 0 ? conDinero : [vacio]
  return usar.map(m => importeClaux(totales[m], m, decimales)).join(' · ')
}
