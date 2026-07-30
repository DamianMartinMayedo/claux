// ── Valor del inventario ──
//
// La regla de honestidad, que es lo que evita que el número mienta: un producto
// SIN coste registrado en esa moneda **no cuenta como 0**. Se cuenta aparte y la UI
// lo dice al lado de la cifra («48.200 CUP · 3 referencias sin coste»). Es la misma
// disciplina de la regla del P&L progresivo: un dato pobre presentado como completo
// es peor que un hueco visible.
//
// Multimoneda: valor NATIVO por moneda, sin convertir. Es lo que ya fijó Reportes —
// con datos reales en una moneda no se convierte a otra por detrás.

export interface FilaValorable {
  producto_id: string
  cantidad:    number
  /** `products.costos`: { CUP: 120, USD: 1.2 }. */
  costos:      Record<string, number> | null | undefined
}

export interface ValorMoneda {
  moneda:      string
  valor:       number
  /** Referencias con existencias pero sin coste en ESTA moneda. */
  sinCoste:    number
  referencias: number
}

/** Valor en UNA moneda. Solo cuentan las cantidades positivas: un negativo no es valor. */
export function valorarStock(filas: FilaValorable[], moneda: string): ValorMoneda {
  let valor = 0, sinCoste = 0, referencias = 0
  for (const f of filas) {
    if (f.cantidad <= 0.0005) continue
    referencias++
    const coste = f.costos?.[moneda]
    if (coste == null) { sinCoste++; continue }
    valor += f.cantidad * Number(coste)
  }
  return { moneda, valor, sinCoste, referencias }
}

/**
 * Un valor por cada moneda en la que HAY algún coste registrado.
 *
 * No se inventa una moneda: si el cliente no ha puesto costes, la lista sale vacía
 * y la UI dice que no se puede calcular, en vez de enseñar un 0 que parece un dato.
 */
export function valorarPorMoneda(filas: FilaValorable[], monedas: string[]): ValorMoneda[] {
  const conCoste = monedas.filter(m => filas.some(f => f.cantidad > 0.0005 && f.costos?.[m] != null))
  return conCoste.map(m => valorarStock(filas, m))
}

/** Formato corto para las tarjetas: «48.200 CUP». */
export function fmtValor(v: number, moneda: string): string {
  return `${v.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${moneda}`
}
