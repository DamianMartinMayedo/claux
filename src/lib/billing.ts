/**
 * Lógica de facturación de los módulos à la carte.
 *
 * Fuente única del precio: `modulos_catalogo`, sumando los módulos activos por la
 * COLUMNA DEL NIVEL contratado (`lib/niveles.ts`). Ese total se cachea en
 * `clients.precio_mensual_usd` **sin descuento**: es lo que cuesta, no lo que se
 * cobra. Encima van, en este orden:
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
 * Etiqueta del precio de la suscripción según el ciclo.
 * - mensual: "$35.00/mes"
 * - anual:   "$378.00/año" (el total anual ya con descuento; nunca "/mes · Anual").
 */
export function suscripcionLabel(precioMensual: number, ciclo: string, descuentoAnualPct: number): string {
  const m = Number(precioMensual) || 0
  if (ciclo === 'anual') {
    return `$${importeCiclo(m, 'anual', descuentoAnualPct).toFixed(2)}/año`
  }
  return `$${m.toFixed(2)}/mes`
}

// ── Lo que el cliente paga de verdad ─────────────────────────────────────────

/** Lo que hace falta saber del cliente para resolver su cuota. */
export interface CondicionesCliente {
  /** Suma de catálogo del nivel, cacheada en `clients.precio_mensual_usd`. */
  precio_mensual_usd: number | string | null
  descuento_pct?:     number | string | null
  descuento_desde?:   string | null
  descuento_hasta?:   string | null
  es_socio?:          boolean | null
  socio_hasta?:       string | null
}

/** Columnas de `clients` que piden las tres funciones de abajo. Cópialas tal cual. */
export const COLUMNAS_CONDICIONES =
  'precio_mensual_usd, descuento_pct, descuento_desde, descuento_hasta, es_socio, socio_hasta'

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
 */
export function descuentoVigente(c: CondicionesCliente, hoy = hoyISO()): number {
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
  if (esSocioHoy(c, hoy)) return 0
  const base = Number(c.precio_mensual_usd ?? 0) || 0
  const pct  = descuentoVigente(c, hoy)
  return Math.round(base * (1 - pct / 100) * 100) / 100
}
