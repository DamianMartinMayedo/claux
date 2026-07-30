// ── Lectura de números escritos por una persona ──
//
// Vive aquí, y no dentro de un módulo, porque el problema es del producto entero:
// nació en Ventas y volvía a aparecer intacto en Inventario. Importar el helper de
// Ventas desde Inventario ataría dos módulos que la regla de independencia mantiene
// sueltos (docs/CONTEXTO.md §2), así que la pieza compartida sube a src/lib/.

/**
 * Lee un número escrito por una persona.
 *
 * «0,5» es medio kilo en todo el mundo hispanohablante y `parseFloat('0,5')` devuelve
 * **0**: el input `type=number` de un navegador con locale es y coma decimal entrega la
 * cadena con coma, y el importe se guardaba a cero sin decir nada. Se normaliza antes de
 * parsear, y una cadena vacía o basura vale 0 (no NaN, que envenena todos los totales).
 */
export function parseNumeroEs(v: string | number | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/**
 * Igual que `parseNumeroEs`, pero distingue «vacío» de «cero».
 *
 * Lo necesitan los campos opcionales del servidor (el costo unitario de una entrada,
 * el stock mínimo): guardar 0 donde el dueño no escribió nada no es lo mismo que
 * guardar NULL, y con `parseNumeroEs` a secas los dos casos se confunden.
 */
export function parseNumeroEsOpcional(v: string | number | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** El texto que se pinta en un campo numérico: coma decimal, como se teclea. */
export function textoNumeroEs(n: number): string {
  return String(n).replace('.', ',')
}
