// ─────────────────────────────────────────────────────────────────────────────
// Niveles comerciales: Inicial · Empresa · Pro.
//
// Plan: docs/planes/niveles-comerciales.md
//
// El nivel es el único eje del precio. Sustituye a la vieja `tarifa`
// fundador/estándar, que eran el MISMO producto a dos precios —una cortesía a los
// primeros clientes que no daba nada a cambio— por tres escalones que sí se
// diferencian: el nivel fija cuánto cuesta cada módulo Y cuánto cabe dentro
// (`lib/limites.ts`).
//
// LAS CLAVES NO CAMBIAN NUNCA. `inicial`/`empresa`/`pro` están en un CHECK de
// `clients.nivel`, en la PK de `niveles` y en el nombre de tres columnas de
// `modulos_catalogo`. Lo que el cliente lee sale de `niveles.nombre` y se edita
// desde /admin sin tocar código: si mañana «Empresa» pasa a llamarse «Negocio»,
// es un UPDATE, no un despliegue.
// ─────────────────────────────────────────────────────────────────────────────

export type Nivel = 'inicial' | 'empresa' | 'pro'

/** En orden de menor a mayor. El orden importa: lo usan los selectores y el upsell. */
export const NIVELES: readonly Nivel[] = ['inicial', 'empresa', 'pro'] as const

export type CampoPrecio = 'precio_inicial_usd' | 'precio_empresa_usd' | 'precio_pro_usd'

/** Columna de `modulos_catalogo` con el precio de cada nivel. */
export const CAMPO_PRECIO: Record<Nivel, CampoPrecio> = {
  inicial: 'precio_inicial_usd',
  empresa: 'precio_empresa_usd',
  pro:     'precio_pro_usd',
}

/**
 * Nombres de respaldo. Los de verdad viven en `niveles.nombre` y los edita el
 * dueño; estos son para cuando no se ha leído la tabla (un PDF, un correo, una
 * pantalla que no puede permitirse otra consulta).
 */
export const NOMBRE_NIVEL: Record<Nivel, string> = {
  inicial: 'Inicial',
  empresa: 'Empresa',
  pro:     'Pro',
}

/**
 * Cualquier cosa → un nivel válido.
 *
 * Traduce también los valores viejos (`fundador`, `estandar`) porque siguen
 * llegando de sitios que no son la BD: una query string de un enlace guardado, un
 * presupuesto exportado, un formulario en una pestaña abierta desde antes del
 * cambio. La BD ya está migrada (215/216); esto cubre lo que viene de fuera.
 */
export function normalizarNivel(v: unknown): Nivel {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === 'inicial' || s === 'empresa' || s === 'pro') return s
  if (s === 'fundador') return 'inicial'
  if (s === 'estandar' || s === 'estándar') return 'empresa'
  return 'inicial'
}

/** Columna de precio del nivel (acepta lo que sea y lo normaliza). */
export function campoPrecio(nivel: unknown): CampoPrecio {
  return CAMPO_PRECIO[normalizarNivel(nivel)]
}

/** Nombre de respaldo del nivel. Para lo vivo, `niveles.nombre`. */
export function nombreNivel(nivel: unknown): string {
  return NOMBRE_NIVEL[normalizarNivel(nivel)]
}

/** Fila de `modulos_catalogo` con los tres precios. Lo que pide todo el que suma. */
export interface ModuloPrecios {
  clave:              string
  precio_inicial_usd: number | string | null
  precio_empresa_usd: number | string | null
  precio_pro_usd:     number | string | null
}

/** Precio de un módulo en un nivel. */
export function precioModulo(m: ModuloPrecios, nivel: unknown): number {
  return Number(m[campoPrecio(nivel)] ?? 0)
}

/**
 * Suma de los módulos contratados en ese nivel. **El precio de catálogo, sin
 * descuento**: el descuento es del cliente, no del catálogo, y se aplica después
 * (`lib/billing.ts`).
 */
export function sumarModulos(catalogo: ModuloPrecios[], claves: string[], nivel: unknown): number {
  const campo = campoPrecio(nivel)
  return catalogo
    .filter(m => claves.includes(m.clave))
    .reduce((total, m) => total + Number(m[campo] ?? 0), 0)
}
