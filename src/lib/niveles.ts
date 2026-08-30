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

import { normalizarMonedaClaux, type MonedaClaux } from '@/lib/moneda-claux'

export type Nivel = 'inicial' | 'empresa' | 'pro'

/** En orden de menor a mayor. El orden importa: lo usan los selectores y el upsell. */
export const NIVELES: readonly Nivel[] = ['inicial', 'empresa', 'pro'] as const

export type CampoPrecio =
  | 'precio_inicial_usd' | 'precio_empresa_usd' | 'precio_pro_usd'
  | 'precio_inicial_eur' | 'precio_empresa_eur' | 'precio_pro_eur'

/**
 * Columna de `modulos_catalogo` con el precio de cada nivel EN CADA MONEDA
 * (mig. 225). Seis columnas, y las seis son precios propios: la de euros no se
 * deriva de la de dólares ni al leer ni al escribir.
 *
 * El índice pasó de `CAMPO_PRECIO[nivel]` a `CAMPO_PRECIO[moneda][nivel]` a
 * propósito: rompe la compilación en cada sitio que pedía un precio sin decir en
 * qué moneda, que es exactamente la lista que había que revisar.
 */
export const CAMPO_PRECIO: Record<MonedaClaux, Record<Nivel, CampoPrecio>> = {
  USD: {
    inicial: 'precio_inicial_usd',
    empresa: 'precio_empresa_usd',
    pro:     'precio_pro_usd',
  },
  EUR: {
    inicial: 'precio_inicial_eur',
    empresa: 'precio_empresa_eur',
    pro:     'precio_pro_eur',
  },
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

/** Columna de precio del nivel en esa moneda (acepta lo que sea y lo normaliza). */
export function campoPrecio(nivel: unknown, moneda: unknown): CampoPrecio {
  return CAMPO_PRECIO[normalizarMonedaClaux(moneda)][normalizarNivel(nivel)]
}

/**
 * Una casilla de la rejilla de precios del catálogo: moneda × nivel. Seis en
 * total. Es lo que se edita, lo que se siembra y lo que se cobra.
 */
export interface ColumnaPrecio {
  moneda: MonedaClaux
  nivel:  Nivel
}

/** Nombre de respaldo del nivel. Para lo vivo, `niveles.nombre`. */
export function nombreNivel(nivel: unknown): string {
  return NOMBRE_NIVEL[normalizarNivel(nivel)]
}

/**
 * Fila de `modulos_catalogo` con los SEIS precios. Lo que pide todo el que suma.
 *
 * Las de euros son opcionales para no romper a quien lea solo las de dólares
 * (el `select` de una métrica interna, por ejemplo), pero `precioModulo` hace
 * `?? 0`: un módulo activo sin precio en euros sale GRATIS en euros. Por eso
 * `audit:nivel` exige los seis y no los tres.
 */
export interface ModuloPrecios {
  clave:               string
  precio_inicial_usd:  number | string | null
  precio_empresa_usd:  number | string | null
  precio_pro_usd:      number | string | null
  precio_inicial_eur?: number | string | null
  precio_empresa_eur?: number | string | null
  precio_pro_eur?:     number | string | null
}

/** Las seis columnas de precio, para los `select`. Una sola fuente del literal. */
export const COLUMNAS_PRECIO =
  'precio_inicial_usd, precio_empresa_usd, precio_pro_usd, '
  + 'precio_inicial_eur, precio_empresa_eur, precio_pro_eur'

/** Precio de un módulo en un nivel y una moneda. */
export function precioModulo(m: ModuloPrecios, nivel: unknown, moneda: unknown): number {
  return Number(m[campoPrecio(nivel, moneda)] ?? 0)
}

/**
 * Suma de los módulos contratados en ese nivel. **El precio de catálogo, sin
 * descuento**: el descuento es del cliente, no del catálogo, y se aplica después
 * (`lib/billing.ts`).
 */
export function sumarModulos(
  catalogo: ModuloPrecios[], claves: string[], nivel: unknown, moneda: unknown,
): number {
  const campo = campoPrecio(nivel, moneda)
  return catalogo
    .filter(m => claves.includes(m.clave))
    .reduce((total, m) => total + Number(m[campo] ?? 0), 0)
}
