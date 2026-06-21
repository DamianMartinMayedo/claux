// ── Fechas y horas en la zona horaria del negocio ──
// Los negocios de CLAUX operan en Cuba (CONTEXTO §7) y el backend se aloja
// fuera (España/EEUU). Calcular "hoy" / "ahora" con la hora del servidor o en
// UTC corre la fecha y rechaza horas válidas de noche. Estos helpers anclan los
// cálculos a la zona del negocio (por defecto America/Havana).

export const TZ_NEGOCIO = 'America/Havana'

/** Fecha de hoy (YYYY-MM-DD) en la zona del negocio. */
export function hoyEnTz(tz: string = TZ_NEGOCIO): string {
  // 'en-CA' formatea como 2026-06-21
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** Hora actual (HH:MM, 24h) en la zona del negocio. */
export function ahoraEnTz(tz: string = TZ_NEGOCIO): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date())
}

/** Suma días a una fecha YYYY-MM-DD (aritmética de calendario, sin saltos por DST). */
export function sumarDias(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + dias)
  return dt.toISOString().split('T')[0]
}
