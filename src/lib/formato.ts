// Formato de cifras de la plataforma. Vive aquí porque había DIEZ copias idénticas de
// `formatMonto` repartidas por las vistas del portal, y una copia es donde un formato se
// arregla en un sitio y se queda roto en los otros nueve.

/**
 * «787.764,00» · «4.753,94». Dos decimales SIEMPRE —en dinero, «1.200,5» se lee mal— y
 * separador de millares SIEMPRE.
 *
 * `useGrouping: 'always'` no es un adorno: en español el separador se omite por defecto a
 * partir de cuatro cifras (`minimumGroupingDigits = 2`), así que una fila de saldos salía
 * «787.764,00 · 4753,94 · 10.516,50» — la del medio con otra forma que sus vecinas, que es
 * justo la que hay que comparar. En un motor viejo que no conozca el valor, la opción se
 * lee como «agrupa» y se degrada al comportamiento de antes; nunca lanza.
 */
export function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', {
    minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always',
  })
}

/**
 * Una tasa de cambio, para IMPRIMIRLA. No es un importe: su magnitud va de 0,0013
 * (CUP→EUR) a 120 (EUR→CUP), así que dos decimales fijos redondean la primera a cero y
 * el número en crudo escupe los diecisiete decimales del `double` en mitad de un
 * concepto. Por debajo de 1 manda la cifra significativa; por encima, dos decimales.
 *
 * Solo para texto. Los cálculos van con el número entero, nunca con esto.
 */
export function formatTasa(n: number): string {
  return n.toLocaleString('es-ES', n < 1
    ? { maximumSignificantDigits: 4 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

/**
 * El mismo importe partido en dos: «787.764» y «,00». Una cifra grande se lee mejor con
 * los céntimos en pequeño —lo que se mira de un vistazo es la magnitud, y a 36 px dos
 * decimales a tamaño completo pesan lo mismo que los millares—. Es un corte de
 * PRESENTACIÓN: el número es el mismo, y el texto concatenado sigue siendo `formatMonto`.
 */
export function partirMonto(n: number): [entero: string, decimales: string] {
  const t = formatMonto(n)
  const i = t.lastIndexOf(',')
  return i === -1 ? [t, ''] : [t.slice(0, i), t.slice(i)]
}

/**
 * «+1.200,00» / «−1.200,00». Con signo delante para las cifras que solo se entienden con
 * él —la variación de un saldo, las transferencias del flujo—: suman o restan según hacia
 * dónde fue el dinero. El menos es el tipográfico (U+2212), como en toda la plataforma.
 */
export function formatSigno(n: number): string {
  return `${n < 0 ? '−' : '+'}${formatMonto(Math.abs(n))}`
}
