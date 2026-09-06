// ── El contrato de una propuesta supervisada ─────────────────────────────────
// La forma ÚNICA en la que la IA interna le enseña al equipo algo que va a
// escribir. Todas las funciones del admin devuelven esto y el mismo panel lo
// pinta (`components/ia/PanelPropuestaIa.tsx`), porque las cuatro condiciones de
// la supervisión no se pueden dejar a lo que se acuerde cada pantalla:
//
//   1. VISTA PREVIA de lo que va a cambiar — no un texto que lo describe: el
//      valor de antes y el de después, línea a línea.
//   2. UN CLIC aplica el lote, y las líneas se pueden desmarcar. Si hubiera que
//      confirmar una a una, la IA no habría quitado el trabajo: lo habría
//      disfrazado.
//   3. CONFIANZA declarada por línea, y lo dudoso NACE DESMARCADO. Una sugerencia
//      sin confianza obliga a revisarlo todo con la misma atención, que es
//      justo lo que se quería evitar.
//   4. TRAZA: lo aplicado deja rastro en `audit_log` diciendo que vino de IA.
//
// Ojo a la frontera (docs/planes/ia-claux-plataforma.md §1): esto es del ADMIN.
// En el portal la IA sigue proponiendo sin escribir; que aquí se pueda escribir
// tras un clic no autoriza a llevarlo allí.

import type { FnIa } from './funciones'

export type Confianza = 'alta' | 'media' | 'baja'

export interface LineaPropuesta<T> {
  /** Identifica la línea al aplicar. Estable: es la clave del registro o del campo. */
  clave: string
  /** Qué es esto, en las palabras del panel («Proveedor: Cárnicos SA»). */
  titulo: string
  /** Lo que hay ahora. `null` cuando no había nada (es un alta). */
  antes: string | null
  /** Lo que quedaría si se aplica. */
  despues: string
  confianza: Confianza
  /** Por qué lo propone, en una frase. Es lo que hace revisable una línea dudosa. */
  motivo?: string
  /** El valor real que se aplica. El panel no lo mira; lo usa quien aplica. */
  valor: T
}

export interface PropuestaIa<T> {
  lineas: LineaPropuesta<T>[]
  /** Aviso del conjunto: lo que la IA no supo, lo que dejó fuera. */
  nota?: string
}

/**
 * Lo que se dice cuando el modelo no contesta, contesta algo ilegible o no está
 * configurado. Es un FALLO, no una decisión nuestra —la bolsa agotada y el
 * interruptor tienen sus propios mensajes, y esos no se reintentan—, así que la
 * pantalla que lo enseña ofrece siempre volver a pedirlo.
 */
export const IA_SIN_RESPUESTA = 'La IA no ha contestado esta vez.'

/** Orden de revisión: lo dudoso primero, que es lo que hay que mirar. */
const PESO: Record<Confianza, number> = { baja: 0, media: 1, alta: 2 }

export function ordenarParaRevisar<T>(lineas: LineaPropuesta<T>[]): LineaPropuesta<T>[] {
  return [...lineas].sort((a, b) => PESO[a.confianza] - PESO[b.confianza])
}

/** Lo que nace marcado: solo la confianza alta. La regla vive aquí, no en cada panel. */
export function naceMarcada(c: Confianza): boolean {
  return c === 'alta'
}

export const ETIQUETA_CONFIANZA: Record<Confianza, string> = {
  alta:  'Segura',
  media: 'Repasar',
  baja:  'Dudosa',
}

/** El badge del design system que le toca a cada confianza. */
export const BADGE_CONFIANZA: Record<Confianza, string> = {
  alta:  'badge-success',
  media: 'badge-warning',
  baja:  'badge-error',
}

/**
 * El sello de auditoría. Va en la `description` de `logActividad`, que es texto
 * libre: no hace falta columna nueva para saber que algo lo escribió la IA, y sí
 * hace falta que se lea igual en las nueve pantallas.
 */
export function selloIa(fn: FnIa, aplicadas: number, propuestas: number): string {
  return `IA (${fn}): ${aplicadas} de ${propuestas} líneas aplicadas`
}
