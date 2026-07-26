// ── Períodos de comparación del P&L — lógica pura ───────────────────────────
//
// «Comparado con qué» es una decisión de producto, no aritmética suelta:
//
//  · ANTERIOR (por defecto) — el período inmediatamente previo. Es el que
//    responde «¿voy mejor que el mes pasado?», la pregunta de gestión diaria.
//  · INTERANUAL (opcional) — el mismo período del año pasado. Aísla la
//    estacionalidad, pero en Cuba, con inflación alta, un +40% interanual puede
//    ser solo que los precios subieron. Por eso NO es el defecto: se ofrece, y
//    el que lo elige sabe lo que mira.
//
// Las fechas son 'YYYY-MM-DD' y se manipulan en UTC a propósito: son fechas de
// calendario (fecha de factura, fecha de gasto), no instantes. Construirlas con
// `new Date(y, m, d)` local haría que el servidor (UTC en Vercel) y el navegador
// del dueño (Habana) pudieran desplazarlas un día.

export type ModoComparacion = 'anterior' | 'interanual' | 'no'

export const MODOS_COMPARACION: ModoComparacion[] = ['anterior', 'interanual', 'no']

export const LABEL_COMPARACION: Record<ModoComparacion, string> = {
  anterior:   'Período anterior',
  interanual: 'Año pasado',
  no:         'Sin comparar',
}

export function esModoComparacion(v: unknown): v is ModoComparacion {
  return typeof v === 'string' && (MODOS_COMPARACION as string[]).includes(v)
}

const DIA_MS = 86_400_000

function aUTC(f: string): Date | null {
  const [y, m, d] = f.split('-').map(Number)
  if (!y || !m || !d) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  return Number.isNaN(dt.getTime()) ? null : dt
}

function aISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Último día del mes (UTC), con el truco clásico del día 0 del siguiente. */
function finDeMes(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
}

/** ¿El rango cubre EXACTAMENTE uno o varios meses naturales completos? */
function esMesesEnteros(a: Date, b: Date): boolean {
  return a.getUTCDate() === 1 && b.getUTCDate() === finDeMes(b.getUTCFullYear(), b.getUTCMonth())
}

/** Desplaza una fecha N meses, pegándose al fin de mes si el destino es más corto. */
function sumarMeses(d: Date, meses: number): Date {
  const y = d.getUTCFullYear(), m0 = d.getUTCMonth(), dia = d.getUTCDate()
  const destino = new Date(Date.UTC(y, m0 + meses, 1))
  const tope = finDeMes(destino.getUTCFullYear(), destino.getUTCMonth())
  return new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth(), Math.min(dia, tope)))
}

export interface Periodo { desde: string; hasta: string }

/**
 * Período con el que comparar. Devuelve null si no hay comparación posible
 * (modo 'no' o fechas ilegibles) — y entonces el informe simplemente no pinta
 * la columna, en vez de inventarse un cero.
 *
 * Un rango de meses ENTEROS se desplaza por meses naturales, no por días: julio
 * (31 d) comparado con «31 días antes» sería del 31 de mayo al 30 de junio, un
 * período a caballo que no es «el mes pasado» de nadie.
 */
export function periodoComparacion(
  desde: string, hasta: string, modo: ModoComparacion,
): Periodo | null {
  if (modo === 'no') return null
  const a = aUTC(desde), b = aUTC(hasta)
  if (!a || !b || a > b) return null

  if (modo === 'interanual') {
    return { desde: aISO(sumarMeses(a, -12)), hasta: aISO(sumarMeses(b, -12)) }
  }

  if (esMesesEnteros(a, b)) {
    const meses = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1
    const nuevoDesde = sumarMeses(a, -meses)
    const finAnterior = new Date(a.getTime() - DIA_MS)
    return { desde: aISO(nuevoDesde), hasta: aISO(finAnterior) }
  }

  const dias = Math.round((b.getTime() - a.getTime()) / DIA_MS) + 1
  const finAnterior = new Date(a.getTime() - DIA_MS)
  return { desde: aISO(new Date(finAnterior.getTime() - (dias - 1) * DIA_MS)), hasta: aISO(finAnterior) }
}

export type RangoTipo = 'mes' | 'trimestre' | 'semestre' | 'anio'

/**
 * Clasifica un rango como mes/trimestre/semestre/año natural COMPLETO del mismo
 * año, o `null` si es un rango a medida. Sirve para etiquetar la comparación
 * («Mes anterior», «Trimestre anterior»…) y para saber cuándo «período anterior»
 * y «año pasado» coinciden (rango = año entero) y sobra ofrecer los dos.
 */
export function clasificarRango(desde: string, hasta: string): RangoTipo | null {
  const a = aUTC(desde), b = aUTC(hasta)
  if (!a || !b) return null
  const y = a.getUTCFullYear()
  if (y !== b.getUTCFullYear()) return null
  const md = a.getUTCMonth(), mh = b.getUTCMonth()
  if (a.getUTCDate() !== 1 || b.getUTCDate() !== finDeMes(y, mh)) return null
  if (md === mh) return 'mes'
  if (md % 3 === 0 && mh === md + 2) return 'trimestre'
  if ((md === 0 && mh === 5) || (md === 6 && mh === 11)) return 'semestre'
  if (md === 0 && mh === 11) return 'anio'
  return null
}

const LABEL_ANTERIOR: Record<RangoTipo, string> = {
  mes: 'Mes anterior', trimestre: 'Trimestre anterior',
  semestre: 'Semestre anterior', anio: 'Año anterior',
}

/** Etiqueta del período de comparación «anterior» según el rango; genérica si es a medida. */
export function etiquetaAnterior(desde: string, hasta: string): string {
  const t = clasificarRango(desde, hasta)
  return t ? LABEL_ANTERIOR[t] : 'Período anterior'
}

const LABEL_INTERANUAL: Record<RangoTipo, string> = {
  mes: 'Mismo mes del año pasado', trimestre: 'Mismo trimestre del año pasado',
  semestre: 'Mismo semestre del año pasado', anio: 'Año pasado',
}

/**
 * Etiqueta del interanual. «Año pasado» a secas MIENTE cuando ves un mes: suena a
 * «todo el año pasado» y en realidad compara junio con junio. La duración nunca
 * cambia —un mes se compara con un mes—, solo se desplaza 12 meses.
 */
export function etiquetaInteranual(desde: string, hasta: string): string {
  const t = clasificarRango(desde, hasta)
  return t ? LABEL_INTERANUAL[t] : 'Mismo período del año pasado'
}

/** '2026-07' → 'jul 2026'. Para ejes y etiquetas de la evolución mensual. */
export function etiquetaMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  if (!y || !m) return mes
  const nombre = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)))
  return `${nombre.replace('.', '')} ${y}`
}
