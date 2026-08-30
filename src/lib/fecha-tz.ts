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

/**
 * Hora (HH:MM, 24h) de un instante ISO, en la zona del negocio.
 *
 * Con `timeZone` FIJO a propósito: un `toLocaleTimeString()` a secas en un componente
 * cliente da una hora en el SSR (UTC en Vercel) y otra en el navegador — mismatch de
 * hidratación y, encima, una hora que no es la del negocio.
 */
export function horaEnTz(iso: string, tz: string = TZ_NEGOCIO): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso))
}

/**
 * Fecha del calendario del NEGOCIO (YYYY-MM-DD) de un instante ISO.
 *
 * Es el compañero de `hoyEnTz` para comparar: `fechaEnTz(t.fecha) === hoyEnTz()`.
 * **Nunca `iso.slice(0, 10)`** — eso es la fecha UTC, y Cuba va cuatro o cinco horas
 * por detrás, así que a partir de las 20:00 hora local devuelve **el día siguiente**:
 * una venta de la cena desaparecía de «las de hoy» en el mismo momento de cobrarla.
 */
export function fechaEnTz(iso: string, tz: string = TZ_NEGOCIO): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

/**
 * Días de CALENDARIO del negocio transcurridos desde `iso` (por defecto, hasta hoy).
 *
 * Cuenta cambios de fecha, no múltiplos de 24 h: un turno abierto anoche a las 23:00 y
 * mirado esta mañana a las 8:00 lleva **1 día** («desde ayer»), que es lo que diría
 * cualquiera, aunque hayan pasado nueve horas. Para «lleva X horas» está `horasDesde`.
 */
export function diasDeCalendario(iso: string, hastaISO?: string, tz: string = TZ_NEGOCIO): number {
  const dia = (f: string) => {
    const [a, m, d] = f.split('-').map(Number)
    return Date.UTC(a, m - 1, d)
  }
  const desde = dia(fechaEnTz(iso, tz))
  const hasta = dia(hastaISO ? fechaEnTz(hastaISO, tz) : hoyEnTz(tz))
  return Math.round((hasta - desde) / 86_400_000)
}

/** Minutos de desfase de una zona en un instante dado (Cuba: −240 en verano, −300 en invierno). */
function offsetMinutos(instante: Date, tz: string): number {
  const parte = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(instante).find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m = parte.match(/GMT([+-])(\d{2}):(\d{2})/)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}

/**
 * Instante ISO (UTC) que corresponde a una hora del calendario del NEGOCIO.
 *
 * Es lo que hace falta para filtrar una columna `timestamptz` por días del negocio: una
 * fecha desnuda (`'2026-08-06T00:00:00'`) la interpreta Postgres en SU zona —UTC—, así que
 * «hoy» acababa siendo el día UTC y se comía las últimas cuatro o cinco horas de la jornada
 * cubana, que en un restaurante son las de más venta.
 *
 * El desfase se resuelve DOS veces —la segunda ya sobre el instante corregido— porque Cuba
 * cambia de horario y en los dos días del año en que eso ocurre la primera lectura puede
 * caer al otro lado del salto.
 */
export function instanteEnTz(fecha: string, hora = '00:00:00.000', tz: string = TZ_NEGOCIO): string {
  const tentativo = new Date(`${fecha}T${hora}Z`)
  const primero   = new Date(tentativo.getTime() - offsetMinutos(tentativo, tz) * 60_000)
  return new Date(tentativo.getTime() - offsetMinutos(primero, tz) * 60_000).toISOString()
}

/** Los dos extremos de un día del negocio, listos para un `gte`/`lte` sobre `timestamptz`. */
export function diaDelNegocio(fecha: string, tz: string = TZ_NEGOCIO): { inicio: string; fin: string } {
  return { inicio: instanteEnTz(fecha, '00:00:00.000', tz), fin: instanteEnTz(fecha, '23:59:59.999', tz) }
}

export interface RelojNegocio {
  /** Fecha del calendario del negocio (YYYY-MM-DD). */
  fecha: string
  /** Hora del reloj del negocio, 0-23. Para comparar («¿ya son las 5?»). */
  hora:  number
  /** «05:00». Para decírselo al dueño tal cual. */
  hhmm:  string
}

/**
 * Fecha y hora del negocio en UNA lectura del reloj.
 *
 * `hoyEnTz` + `ahoraEnTz` valen para leer una cosa u otra, pero quien decide
 * «¿toca ya el barrido de hoy?» necesita las dos a la vez y COHERENTES: dos
 * llamadas separadas pueden caer a lados distintos de la medianoche y dar la
 * fecha de ayer con la hora de hoy. Lo usa el cron de tasas, que se programa en
 * UTC pero tiene que dispararse a una hora del reloj cubano — y La Habana no
 * tiene desfase fijo (UTC−4 en verano, UTC−5 en invierno), así que la hora se
 * pregunta a la zona horaria, no se resta a mano.
 */
export function relojNegocio(ahora: Date = new Date(), tz: string = TZ_NEGOCIO): RelojNegocio {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(ahora)
  const v = (tipo: string): string => partes.find(p => p.type === tipo)?.value ?? ''
  return {
    fecha: `${v('year')}-${v('month')}-${v('day')}`,
    hora:  Number(v('hour')),
    hhmm:  `${v('hour')}:${v('minute')}`,
  }
}

/**
 * Año de una fecha YYYY-MM-DD, leído del texto.
 *
 * `new Date('2026-01-01').getFullYear()` no vale: la cadena se interpreta como
 * medianoche UTC y el año se lee en la zona del servidor, así que en offset
 * negativo (La Habana, EEUU) el 1 de enero devuelve el año anterior. En un listado
 * da igual; en la numeración fiscal significa emitir una factura de 2026 con el
 * correlativo y el año de 2025, dentro de una serie ya cerrada.
 *
 * Para el año de HOY: `anioDeFecha(hoyEnTz())` — nunca `new Date().getFullYear()`,
 * que en Vercel (UTC) ya es enero desde las 19:00 del 31 de diciembre en Cuba.
 */
export function anioDeFecha(fechaISO: string): number {
  return Number(fechaISO.slice(0, 4))
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
