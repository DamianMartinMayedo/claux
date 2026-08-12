// ── Aritmética del cuadrante — lógica PURA, sin I/O ───────────────────────────
//
// Vive fuera de los ficheros `'use server'` porque la necesitan las dos orillas: la
// rejilla al pintar los totales y —desde la Fase 4— la sugerencia de días trabajados
// que alimenta la nómina. Con una copia en cada sitio, lo que la pantalla enseña y lo
// que se guarda acaban discrepando; es la misma razón por la que `aplicarConceptos` es
// una sola función.
//
// LO QUE ESTE MÓDULO **NO** SABE. La rejilla es una SEMANA TIPO, no un calendario: no
// hay fechas, ni ausencias, ni rotaciones. Lo que dice es «según lo planificado», y esa
// distinción tiene que llegar entera al usuario — la sugerencia de días de la nómina se
// presenta como propuesta, no como dato.

/** Lo mínimo que hace falta de un turno para contar horas. */
export interface TurnoHorario {
  hora_inicio: string | null
  hora_fin:    string | null
  es_descanso: boolean
}

/** Minutos desde medianoche de un 'HH:MM' o 'HH:MM:SS'. `null` si no hay hora. */
function minutos(h: string | null): number | null {
  if (!h) return null
  const [hh, mm] = h.split(':').map(Number)
  if (isNaN(hh) || isNaN(mm)) return null
  return hh * 60 + mm
}

/**
 * ¿El turno termina al día siguiente? Un 22:00–06:00 se pintaba exactamente igual que
 * uno de día, así que el cuadrante no distinguía el turno de noche de un error de
 * tecleo.
 */
export function cruzaMedianoche(t: TurnoHorario): boolean {
  if (t.es_descanso) return false
  const i = minutos(t.hora_inicio), f = minutos(t.hora_fin)
  return i !== null && f !== null && f <= i
}

/**
 * Horas que dura un turno. Un descanso vale 0 y un turno sin horario también: no es lo
 * mismo (el primero es una decisión, el segundo un dato a medio poner), pero para sumar
 * horas los dos aportan cero y el catálogo ya los distingue por su lado.
 */
export function horasDeTurno(t: TurnoHorario | null): number {
  if (!t || t.es_descanso) return 0
  const i = minutos(t.hora_inicio), f = minutos(t.hora_fin)
  if (i === null || f === null) return 0
  // El turno de noche cierra al día siguiente: sin esto daba negativo y la semana
  // entera salía mal sin que nada fallara.
  const dur = f > i ? f - i : (24 * 60) - i + f
  return dur / 60
}

/** Suma de las horas de una semana (siete celdas, las vacías van como `null`). */
export function totalHorasSemana(dias: (TurnoHorario | null)[]): number {
  return dias.reduce((s, t) => s + horasDeTurno(t), 0)
}

/** «38 h» · «37,5 h» · «—» cuando no hay ninguna. */
export function formatHoras(h: number): string {
  if (h <= 0) return '—'
  const redondeado = Math.round(h * 10) / 10
  return `${redondeado.toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`
}

/** ¿Este turno cuenta como día trabajado? Un descanso no; «sin asignar» tampoco. */
export function cuentaComoDiaTrabajado(t: TurnoHorario | null): boolean {
  return !!t && !t.es_descanso
}

// ── Rotación — el patrón cíclico (mig. 182) ──────────────────────────────────
//
// Un patrón es un CICLO de `longitud_dias` que dice, para cada día del ciclo, qué franja
// toca (`slots[posicion]`, `null` = descanso). Anclado a `fecha_ancla`; cada persona
// arranca desplazada por su `offset`. SEMANAL/QUINCENAL/MENSUAL/CICLO son SOLO longitudes
// distintas (7 / 14 / 28 / on+off): aquí no hay ramas por tipo, un único motor las cubre.
//
// Todo por fecha y por aritmética pura, para que el cuadrante (UI) y los días trabajados
// (nómina) salgan de la MISMA cuenta y no puedan discrepar. La rejilla dejó de ser el dato:
// el dato es (patrón, ancla, offset, calendario).

/** Un patrón con sus franjas ya resueltas (el `turno_id` de cada slot mapeado a su horario). */
export interface PatronResuelto {
  longitud_dias: number
  /** 'YYYY-MM-DD': día 0 del ciclo. */
  fecha_ancla:   string
  /** Índice = posición en el ciclo; `null` = descanso ese día. */
  slots:         (TurnoHorario | null)[]
}

const DIA_MS = 86_400_000

/** Medianoche UTC de un 'YYYY-MM-DD' (UTC para que ningún cambio de hora mueva un día). */
function aUTC(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
/** Días enteros de `desde` a `hasta` (hasta − desde). */
function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUTC(hasta) - aUTC(desde)) / DIA_MS)
}
/** El 'YYYY-MM-DD' que resulta de sumar `dias` a `iso`. */
function isoSumar(iso: string, dias: number): string {
  const d = new Date(aUTC(iso) + dias * DIA_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Posición del ciclo (0 … longitud−1) que le toca a este offset en esta fecha. */
export function posicionEnCiclo(p: PatronResuelto, offset: number, iso: string): number {
  const n = p.longitud_dias
  if (n <= 0) return 0
  const bruto = diasEntre(p.fecha_ancla, iso) + offset
  return ((bruto % n) + n) % n   // módulo siempre positivo, aunque la fecha sea anterior al ancla
}

/** La franja que le toca a este offset en esta fecha, o `null` (descanso / slot vacío). */
export function franjaEnFecha(p: PatronResuelto, offset: number, iso: string): TurnoHorario | null {
  return p.slots[posicionEnCiclo(p, offset, iso)] ?? null
}

/** ¿Trabaja (hay franja y no es descanso) este offset en esta fecha? */
export function trabajaEnFecha(p: PatronResuelto, offset: number, iso: string): boolean {
  return cuentaComoDiaTrabajado(franjaEnFecha(p, offset, iso))
}

/** Días trabajados de un patrón en [desde, hasta] inclusive. */
export function diasTrabajadosEnRango(p: PatronResuelto, offset: number, desde: string, hasta: string): number {
  let n = 0
  const total = diasEntre(desde, hasta)
  for (let i = 0; i <= total; i++) if (trabajaEnFecha(p, offset, isoSumar(desde, i))) n++
  return n
}

/** Horas de un patrón en [desde, hasta] = suma de las horas de la franja de cada día. */
export function horasEnRango(p: PatronResuelto, offset: number, desde: string, hasta: string): number {
  let h = 0
  const total = diasEntre(desde, hasta)
  for (let i = 0; i <= total; i++) h += horasDeTurno(franjaEnFecha(p, offset, isoSumar(desde, i)))
  return h
}

/**
 * Días trabajados por la UNIÓN de varios patrones en [desde, hasta]: un día cuenta UNA vez
 * aunque dos patrones lo pongan a trabajar. Es lo que necesita el puente de nómina cuando
 * una persona está en más de un patrón (D2), para no inflar sus días trabajados.
 */
export function diasTrabajadosUnionEnRango(
  patrones: { patron: PatronResuelto; offset: number }[],
  desde: string,
  hasta: string,
): number {
  let n = 0
  const total = diasEntre(desde, hasta)
  for (let i = 0; i <= total; i++) {
    const iso = isoSumar(desde, i)
    if (patrones.some(({ patron, offset }) => trabajaEnFecha(patron, offset, iso))) n++
  }
  return n
}
