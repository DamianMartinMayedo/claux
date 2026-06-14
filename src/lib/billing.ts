/**
 * Lógica de facturación del modelo base + módulos à la carte.
 * Fuente única: el precio mensual sale de modulos_catalogo (base + módulos activos por tarifa).
 * El ciclo (mensual/anual) y el descuento anual determinan el importe a cobrar y la duración.
 */

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
