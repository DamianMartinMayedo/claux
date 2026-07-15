// Helpers de formularios del portal compartidos entre módulos.

/**
 * Opciones de un <select> que NUNCA pierde el valor guardado: si `actual` no
 * está en el catálogo (ficha vieja, moneda que el cliente ya no tiene), se
 * añade igualmente. Sin esto el select cae en la primera opción y al guardar
 * escribe otra cosa sin avisar — así se borraban los CUP de los terceros, que
 * no estaban en la lista fija de monedas del formulario.
 */
export function opcionesCon(catalogo: readonly string[], actual?: string | null): string[] {
  return actual && !catalogo.includes(actual) ? [actual, ...catalogo] : [...catalogo]
}

/**
 * Tasa en su dirección legible: nadie lee "1 CUP = 0,0025 USD". `factor` es
 * origen→destino, tal como lo devuelve `mapaTasas`.
 */
export function textoTasa(origen: string, destino: string, factor: number): string {
  const fmt = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return factor >= 1
    ? `1 ${origen} = ${fmt(factor)} ${destino}`
    : `1 ${destino} = ${fmt(1 / factor)} ${origen}`
}
