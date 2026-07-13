export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

// Formato legible en español para correos y avisos: "15 ago 2026".
export function fmtFechaEs(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
