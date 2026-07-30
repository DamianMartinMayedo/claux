// ── La regla de «bajo mínimo», en UNA función ──
//
// Estaba escrita tres veces con DOS criterios distintos: el listado de Productos y
// el widget del dashboard solo marcaban `minimo > 0 && actual <= minimo`, mientras
// el escáner de avisos añadía `actual <= 0`. Resultado real en producción: campana
// roja y dashboard en verde sobre el mismo producto. Aquí manda el criterio del
// escáner, que es el completo, y lo consumen los tres.
//
// Puro y fuera de cualquier fichero 'use server': en un fichero de acciones toda
// exportación es un endpoint HTTP (docs/CONTEXTO.md §2).

export type EstadoStock = 'ok' | 'bajo' | 'agotado' | 'negativo'

/**
 * Estado de una cantidad frente a su mínimo.
 *
 * `negativo` es un estado propio, no una variante de `agotado`: el stock negativo
 * está permitido a propósito (el dueño vende de mostrador con el sistema por
 * detrás), así que la UI lo pinta distinto pero NO genera alarma ni aviso.
 *
 * `minimo` a `null` —o 0— significa «sin umbral configurado»: entonces solo se
 * mira si hay existencias, que es el comportamiento que ya tenía el escáner.
 */
export function estadoStock(cantidad: number, minimo: number | null | undefined): EstadoStock {
  if (cantidad < 0) return 'negativo'
  if (cantidad <= 0) return 'agotado'
  const min = Number(minimo ?? 0)
  return min > 0 && cantidad <= min ? 'bajo' : 'ok'
}

/** Estados que piden acción del dueño. El negativo NO está: se informa, no se alarma. */
export function pideAtencion(e: EstadoStock): boolean {
  return e === 'bajo' || e === 'agotado'
}

/**
 * El mínimo que aplica a un almacén concreto.
 *
 * El de `producto_almacen_config` manda; si no hay fila —o su `stock_minimo` es
 * NULL— se cae al global de `products`, que es el comportamiento de siempre. Por
 * eso el mínimo por almacén es OPCIONAL: quien no configure nada no nota el cambio.
 */
export function minimoAplicable(
  minimoAlmacen: number | null | undefined,
  minimoGlobal: number | null | undefined,
): number {
  return minimoAlmacen != null ? Number(minimoAlmacen) : Number(minimoGlobal ?? 0)
}

export const ESTADO_STOCK_LABEL: Record<EstadoStock, string> = {
  ok:       'En orden',
  bajo:     'Bajo mínimo',
  agotado:  'Agotado',
  negativo: 'En negativo',
}

/**
 * Clase del badge del design system para cada estado.
 *
 * El negativo va en ROJO, no en morado. Iba morado porque «no alarma» (no entra en
 * `pideAtencion` ni en la campana, y eso sigue igual), pero el color no es el canal para
 * decir eso: el morado se lee como una categoría más —una etiqueta informativa— cuando
 * un stock negativo es la única cifra de la tabla que no puede ser cierta. Rojo, como
 * «Agotado»; lo que los distingue es el texto.
 */
export const ESTADO_STOCK_BADGE: Record<EstadoStock, string> = {
  ok:       'badge-success',
  bajo:     'badge-warning',
  agotado:  'badge-error',
  negativo: 'badge-error',
}
