// Política monetaria común de RRHH.
// Trunca hacia cero para no introducir un céntimo que no salió de la fórmula.
export function truncar2(n: number): number {
  // Corrige el ruido binario de valores como 0.29 * 100 sin redondear importes
  // que realmente tienen más de dos decimales.
  const margen = n < 0 ? -1e-9 : 1e-9
  return Math.trunc((n + margen) * 100) / 100
}
