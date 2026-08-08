// ── Estados de una reserva/cita: fuente ÚNICA ────────────────────────────────
//
// Módulo PURO a propósito (cero imports): lo consumen el portal, las descargas, el
// cron y la página pública de gestión por token, que vive en `(public)/` y no puede
// arrastrar el cliente de Telegram ni nada del portal (presupuesto de Cuba).
// `estado.ts` —que sí habla con Telegram— reexporta de aquí.
//
// `reservas.estado` es `text NOT NULL DEFAULT 'PENDIENTE'` SIN CHECK, así que añadir
// un estado no necesita migración de columna. Lo que sí necesita es que estas tres
// tablas y la de la vista pública cambien A LA VEZ: un estado sin etiqueta se pinta
// crudo («CADUCADA») en la pantalla del dueño.

export type EstadoReserva =
  | 'PENDIENTE'
  | 'CONFIRMADA'
  | 'RECHAZADA'
  | 'NO_SHOW'
  | 'CANCELADA'
  | 'ATENDIDA'
  | 'CADUCADA'

export const ESTADO_LABEL: Record<EstadoReserva, string> = {
  PENDIENTE:  'Pendiente',
  CONFIRMADA: 'Confirmada',
  RECHAZADA:  'Rechazada',
  NO_SHOW:    'No asistió',
  CANCELADA:  'Cancelada',
  ATENDIDA:   'Atendió',
  CADUCADA:   'Caducada',
}

export const ESTADO_BADGE: Record<EstadoReserva, string> = {
  PENDIENTE:  'badge-warning',
  CONFIRMADA: 'badge-success',
  RECHAZADA:  'badge-neutral',
  // `badge-danger` NO existe en el design system (es `badge-error`): las dos vistas
  // lo llevaban copiado y el badge de «No asistió» salía sin color desde siempre.
  NO_SHOW:    'badge-error',
  CANCELADA:  'badge-neutral',
  ATENDIDA:   'badge-success',
  CADUCADA:   'badge-neutral',
}

/** Etiqueta de un estado que llega como texto suelto (descargas, datos viejos). */
export function etiquetaEstado(estado: string): string {
  return ESTADO_LABEL[estado as EstadoReserva] ?? estado
}

/**
 * Transiciones permitidas.
 *
 * `CADUCADA` no la pone nadie a mano: la pone el barrido diario sobre lo que se pidió,
 * nadie contestó y ya pasó. `ATENDIDA` la pone el dueño (o el barrido a los
 * `DIAS_CIERRE_AUTO` días). Y volver de CANCELADA/RECHAZADA a PENDIENTE es el
 * «deshacer»: solo si la fecha no ha pasado, y revalidando que la plaza siga libre
 * (lo comprueba `transicionarEstado`, no esta tabla).
 */
export const CAMBIOS_VALIDOS: Record<EstadoReserva, EstadoReserva[]> = {
  PENDIENTE:  ['CONFIRMADA', 'RECHAZADA', 'CANCELADA', 'CADUCADA'],
  CONFIRMADA: ['ATENDIDA', 'NO_SHOW', 'CANCELADA'],
  RECHAZADA:  ['PENDIENTE'],
  CANCELADA:  ['PENDIENTE'],
  NO_SHOW:    [],
  ATENDIDA:   [],
  CADUCADA:   [],
}

/** Estados que vuelven a ocupar plaza: reabrir uno exige revalidar aforo/solape. */
export const ESTADOS_OCUPAN: EstadoReserva[] = ['PENDIENTE', 'CONFIRMADA']

/** Volver aquí es «deshacer», y solo se ofrece con la fecha por delante. */
export const ESTADOS_DESHACIBLES: EstadoReserva[] = ['CANCELADA', 'RECHAZADA']

/**
 * Días que una CONFIRMADA pasada espera a que el dueño diga si el cliente vino,
 * antes de cerrarse sola como ATENDIDA. Es la única suposición del módulo: el
 * no-show es la excepción, y a la semana ya no se acuerda nadie. Se cambia aquí.
 */
export const DIAS_CIERRE_AUTO = 7
