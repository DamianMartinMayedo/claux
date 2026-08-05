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
