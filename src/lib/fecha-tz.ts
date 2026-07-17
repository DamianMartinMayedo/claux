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

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Etiqueta corta del mes de una clave YYYY-MM ('2026-07' → 'jul'). Eje X de los gráficos. */
export function etiquetaMes(mes: string): string {
  return MESES_CORTOS[Number(mes.slice(5, 7)) - 1] ?? mes
}

/**
 * Meses consecutivos entre dos claves YYYY-MM, ambas incluidas y sin huecos.
 * Para series de "todo el histórico", donde el rango lo marcan los datos y no
 * una ventana fija (ahí va `clavesMes`, que cuenta N meses hacia atrás desde hoy).
 * Un mes sin movimiento tiene que existir con valor 0: si se omite, el gráfico
 * junta dos meses distantes como si fueran contiguos y miente sobre el ritmo.
 */
export function mesesEntre(desde: string, hasta: string): { mes: string; etiqueta: string }[] {
  const out: { mes: string; etiqueta: string }[] = []
  let [y, m] = [Number(desde.slice(0, 4)), Number(desde.slice(5, 7))]
  const [yf, mf] = [Number(hasta.slice(0, 4)), Number(hasta.slice(5, 7))]
  while (y < yf || (y === yf && m <= mf)) {
    const mes = `${y}-${String(m).padStart(2, '0')}`
    out.push({ mes, etiqueta: etiquetaMes(mes) })
    if (++m > 12) { m = 1; y++ }
  }
  return out
}
