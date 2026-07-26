// Formato de cifras del informe. Vive aparte porque lo comparten la vista, la
// tarjeta del estado de resultados y el PDF: tres copias de `toLocaleString` con
// distintos decimales es como un informe acaba diciendo dos números para lo mismo.

export function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** «60,0%». Un decimal: en un margen, la segunda cifra es ruido. */
export function formatPct(n: number): string {
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

/**
 * «+8,4%» / «−12,0%» — con signo, que es lo que se lee de un Δ.
 * En un Δ de tres cifras el decimal es ruido (y no cabe en la columna): a partir
 * de ±100% se muestra sin decimales.
 */
export function formatDelta(n: number): string {
  const signo = n > 0 ? '+' : n < 0 ? '−' : ''
  const abs = Math.abs(n)
  const dec = abs >= 100 ? 0 : 1
  return `${signo}${abs.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`
}

export function formatFechaCorta(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
