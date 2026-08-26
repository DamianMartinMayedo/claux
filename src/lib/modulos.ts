// Helpers de módulos à la carte. La contabilidad ('base') es un módulo más:
// se contrata o no como cualquier otro. Un cliente puede tener solo Reservas,
// por ejemplo. Cada módulo funciona solo; otros módulos solo AÑADEN
// conveniencias (ver regla de independencia de módulos en la memoria).

export function normalizarModulos(modulos: unknown): string[] {
  return Array.isArray(modulos) ? (modulos as string[]) : []
}

export function tieneModulo(modulos: unknown, modulo: string): boolean {
  return normalizarModulos(modulos).includes(modulo)
}

export function tieneAlgunModulo(modulos: unknown, claves: string[]): boolean {
  const activos = normalizarModulos(modulos)
  return claves.some(c => activos.includes(c))
}

/**
 * Los módulos que ponen artículos vendibles en la tabla `products`:
 * `inventario` (productos físicos, con existencias), `servicios` (servicios, sin
 * stock) y `caja` (el mostrador cataloga los suyos cuando el cliente NO tiene
 * Inventario: sin esto la rejilla del punto de venta bajaba **vacía** y solo se
 * podía vender tecleando nombre y precio en cada venta). Cada uno tiene su PÁGINA
 * (/portal/productos, /portal/servicios y /portal/caja/productos) y comparten solo
 * la TABLA, filtrada por `tipo`. Esta lista se usa allí donde importa «¿el cliente
 * tiene algo que vender del catálogo?», sin que importe cuál: el selector de
 * productos de ofertas/facturas y el import del catálogo QR (ambos leen `products`
 * de cualquier tipo). El gate de cada PÁGINA, en cambio, es su módulo a secas
 * (`requireModulo`), no esta lista.
 *
 * Ojo al añadir: esto NO decide quién puede editar QUÉ tipo — eso es
 * `modulosDelTipo` en `actions/portal/productos.ts`, y `caja` solo alcanza a los
 * PRODUCTO. Un cliente solo-Caja no puede tocar servicios.
 */
export const MODULOS_CATALOGO: string[] = ['inventario', 'servicios', 'caja']
