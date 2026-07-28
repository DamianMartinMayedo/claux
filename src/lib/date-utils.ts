export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ── Formato legible en español de una columna `date` ──────────────────────────
//
// Se parte la cadena y se construye la fecha en hora LOCAL a propósito:
// `new Date('2026-08-15')` la lee como MEDIANOCHE UTC y al pintarla en La Habana
// (UTC−4) la retrasa un día entero. Eso es lo que hacía este helper y lo que salía
// en los avisos, en el listado de Ventas, en la ficha de la factura y en su PDF.
// No es un detalle de presentación: la fecha de un documento fiscal no puede
// depender de la zona del navegador que lo abre.
//
// Para un `timestamptz` (created_at/updated_at) NO se usa esto: ahí el instante es
// real y `new Date(iso).toLocaleDateString()` es lo correcto.

function formatearFecha(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = (iso ?? '').split('T')[0].split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', opts)
}

/** "15 ago 2026" — listados, correos y avisos. */
export function fmtFechaEs(iso: string): string {
  return formatearFecha(iso, { day: '2-digit', month: 'short', year: 'numeric' })
}

/** "15 agosto 2026" — fichas de documento y PDF. */
export function fmtFechaLargaEs(iso: string): string {
  return formatearFecha(iso, { day: '2-digit', month: 'long', year: 'numeric' })
}
