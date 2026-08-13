// Política monetaria común de RRHH.
// Base: se trunca a 3 decimales (se descarta la 4ª cifra en adelante y el ruido
// binario de valores como 0.29 * 100). Sobre esa base de milésimas se aplica un
// redondeo comercial a 2 decimales (la media va hacia arriba, simétrico en signo).
export function importe2(n: number): number {
  const signo = n < 0 ? -1 : 1
  const milesimas = Math.trunc((Math.abs(n) + 1e-9) * 1000) // base truncada a 3 dec
  return (signo * Math.round(milesimas / 10)) / 100          // redondeo comercial a 2
}
