/**
 * Lógica de facturación de los módulos à la carte.
 *
 * Fuente única del precio: `modulos_catalogo`, sumando los módulos activos por la
 * COLUMNA DEL NIVEL contratado (`lib/niveles.ts`) en la MONEDA de facturación del
 * cliente. Ese total se cachea en `clients.precio_mensual_usd` y su gemela
 * `precio_mensual_eur` —las dos siempre, mig. 225— **sin descuento**: es lo que
 * cuesta, no lo que se cobra. Encima van, en este orden:
 *
 *   1. **Socio CLAUX** (`es_socio`): no paga cuota. Manda sobre todo lo demás.
 *   2. **Descuento del cliente** (`descuento_pct`, con ventana de fechas): la
 *      negociación de la cuota mensual. Es INDEPENDIENTE del descuento del
 *      presupuesto de instalación (`presupuestos_instalacion.descuento_pct`), que
 *      es un pago único y no vuelve a aparecer nunca.
 *   3. **Ciclo** (mensual/anual) con su descuento anual.
 *
 * El descuento NO se cachea a propósito: tiene fecha de caducidad, y un número
 * guardado no caduca solo. Se resuelve al leer, con la fecha de hoy.
 */

import { hoyEnTz } from '@/lib/fecha-tz'
import { importeClaux, normalizarMonedaClaux, type MonedaClaux } from '@/lib/moneda-claux'

export const DIAS_CICLO: Record<string, number> = {
  mensual: 30,
  anual:   365,
}

/** Días de vigencia que cubre un cobro según el ciclo. */
export function diasCiclo(ciclo: string): number {
  return DIAS_CICLO[ciclo] ?? 30
}

/**
 * Importe a cobrar en un ciclo dado el precio mensual.
 * - mensual: el propio precio mensual.
 * - anual:   precio mensual × 12 con el descuento anual aplicado.
 */
export function importeCiclo(precioMensual: number, ciclo: string, descuentoAnualPct: number): number {
  const m = Number(precioMensual) || 0
  if (ciclo === 'anual') {
    const bruto = m * 12
    const neto  = bruto * (1 - (Number(descuentoAnualPct) || 0) / 100)
    return Math.round(neto * 100) / 100
  }
  return Math.round(m * 100) / 100
}

/** Etiqueta corta del ciclo para UI. */
export function cicloLabel(ciclo: string): string {
  return ciclo === 'anual' ? 'Anual' : 'Mensual'
}

/**
 * Etiqueta del precio de la suscripción según el ciclo, en la moneda del cliente.
 * - mensual: "$35.00/mes"  ·  "€35.00/mes"
 * - anual:   "$378.00/año" (el total anual ya con descuento; nunca "/mes · Anual").
 */
export function suscripcionLabel(
  precioMensual: number, ciclo: string, descuentoAnualPct: number, moneda: unknown,
): string {
  const m = Number(precioMensual) || 0
  if (ciclo === 'anual') {
    return `${importeClaux(importeCiclo(m, 'anual', descuentoAnualPct), moneda)}/año`
  }
  return `${importeClaux(m, moneda)}/mes`
}

// ── Lo que el cliente paga de verdad ─────────────────────────────────────────

/** Lo que hace falta saber del cliente para resolver su cuota. */
export interface CondicionesCliente {
  /** Suma de catálogo del nivel en dólares, cacheada en `clients`. */
  precio_mensual_usd:  number | string | null
  /** La gemela en euros (mig. 225). Las dos se mantienen siempre. */
  precio_mensual_eur?: number | string | null
  /** En cuál de las dos se le factura HOY. */
  moneda_facturacion?: string | null
  descuento_pct?:      number | string | null
  descuento_desde?:    string | null
  descuento_hasta?:    string | null
  es_socio?:           boolean | null
  socio_hasta?:        string | null
}

/** Columnas de `clients` que piden las funciones de abajo. Cópialas tal cual. */
export const COLUMNAS_CONDICIONES =
  'precio_mensual_usd, precio_mensual_eur, moneda_facturacion, '
  + 'descuento_pct, descuento_desde, descuento_hasta, es_socio, socio_hasta'

/** En qué moneda se le factura a este cliente. */
export function monedaDelCliente(c: Pick<CondicionesCliente, 'moneda_facturacion'>): MonedaClaux {
  return normalizarMonedaClaux(c.moneda_facturacion)
}

// «Hoy» es el de La Habana, no el del servidor: `toISOString()` es UTC y Cuba va
// cuatro o cinco horas por detrás, así que a partir de las 20:00 ya sería mañana.
// Un descuento que termina hoy, o una condición de socio que vence hoy, se le
// caerían al cliente cuatro horas antes de tiempo — en su pantalla y en su cobro.
const hoyISO = () => hoyEnTz()

/** ¿Está el cliente en condición de socio hoy? `socio_hasta` vacío = indefinido.
 *  Pide solo las dos columnas que mira, no `CondicionesCliente` entera: lo
 *  pregunta gente que no factura nada —el guardia del portal, el barrido de
 *  vencimientos, el escáner de avisos— y obligarles a traerse el precio para
 *  contestar «¿es socio?» era hacerles seleccionar una columna que no usan. */
export function esSocioHoy(
  c: Pick<CondicionesCliente, 'es_socio' | 'socio_hasta'>,
  hoy = hoyISO(),
): boolean {
  if (!c.es_socio) return false
  return !c.socio_hasta || c.socio_hasta >= hoy
}

/**
 * Descuento aplicable HOY, en porcentaje. Fuera de la ventana de fechas: 0.
 * Las fechas son opcionales por los dos lados: sin `desde` empieza ya, sin
 * `hasta` no termina.
 *
 * Pide solo las columnas del descuento, como `esSocioHoy`: el descuento no depende
 * de la moneda ni del precio, y exigir una cuota para contestar «¿cuánto rebaja?»
 * obligaba a la tarjeta de condiciones a inventarse una columna que no mira.
 */
export function descuentoVigente(
  c: Pick<CondicionesCliente, 'descuento_pct' | 'descuento_desde' | 'descuento_hasta'>,
  hoy = hoyISO(),
): number {
  const pct = Number(c.descuento_pct ?? 0)
  if (!(pct > 0)) return 0
  if (c.descuento_desde && hoy < c.descuento_desde) return 0
  if (c.descuento_hasta && hoy > c.descuento_hasta) return 0
  return Math.min(100, pct)
}

/**
 * Cuota mensual REAL: catálogo menos lo pactado. Es la que se cobra, la que se
 * enseña al cliente en su facturación y la que suma al MRR.
 */
export function precioMensualEfectivo(c: CondicionesCliente, hoy = hoyISO()): number {
  // La caché de SU moneda. La otra sigue mantenida y al día, pero no es la suya:
  // cobrarle la columna equivocada es cobrarle otro precio.
  return precioMensualEnMoneda(c, monedaDelCliente(c), hoy)
}

/**
 * La misma cuota, pero en la moneda que se pida. Sirve para lo único que necesita
 * mirar la que HOY no es la suya: proponerle el importe cuando pasa a facturarse
 * en la otra (el dueño puede cambiarla de un mes a otro).
 *
 * Socio y descuento no dependen de la moneda —son condiciones del cliente, no de
 * la divisa—, así que se aplican igual a las dos columnas.
 */
export function precioMensualEnMoneda(
  c: CondicionesCliente, moneda: MonedaClaux, hoy = hoyISO(),
): number {
  if (esSocioHoy(c, hoy)) return 0
  const base = Number((moneda === 'EUR' ? c.precio_mensual_eur : c.precio_mensual_usd) ?? 0) || 0
  const pct = descuentoVigente(c, hoy)
  return Math.round(base * (1 - pct / 100) * 100) / 100
}
