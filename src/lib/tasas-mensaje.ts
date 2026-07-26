// Mensaje HONESTO del resultado de actualizar tasas. Puro (sin servidor), para
// que el botón del widget y el de Monedas digan exactamente lo mismo y ninguno
// cante «actualizadas» cuando una fuente falló o cuando no había nada que traer.
//
// El bug que arregla: con El Toque devolviendo 429 (rate-limit), el mensaje
// anterior sumaba lo que SÍ entró por otra fuente y enseñaba «1 tasa actualizada»
// tapando el fallo — y decía «actualizada» aunque la fuente trajera el mismo
// valor de siempre (ver `sinCambios` en lib/tasas-auto).

export interface ResultadoTasas {
  ok:           boolean
  actualizadas: number
  sinCambios:   number
  errores:      string[]
}

export type TonoToast = 'success' | 'warning' | 'error' | 'info'

export function mensajeTasas(r: ResultadoTasas): { tono: TonoToast; texto: string } {
  if (!r.ok) return { tono: 'error', texto: r.errores[0] ?? 'No se pudieron actualizar las tasas.' }

  const n = r.actualizadas
  const frase = `${n} ${n === 1 ? 'tasa actualizada' : 'tasas actualizadas'}`

  // Alguna fuente falló: nunca es un «éxito» a secas. Solo es 'error' cuando NO
  // se salvó nada (ni un cambio ni una confirmación); si otra fuente respondió,
  // el aviso es de segundo orden.
  if (r.errores.length > 0) {
    // Se juntan como dos frases (no «…, pero …») porque los errores de fuente
    // vienen redactados como oración completa y con mayúscula.
    if (n > 0) return { tono: 'warning', texto: `${frase}. ${r.errores[0]}` }
    return { tono: r.sinCambios > 0 ? 'warning' : 'error', texto: r.errores[0] }
  }

  if (n === 0) {
    // Distinguir «la fuente trae lo mismo» de «no hay nada automático»: el dueño
    // que no ve cambiar la tasa necesita saber cuál de las dos le pasa.
    return r.sinCambios > 0
      ? { tono: 'info', texto: 'Las tasas ya estaban al día.' }
      : { tono: 'info', texto: 'No hay tasas automáticas que actualizar.' }
  }

  return { tono: 'success', texto: `${frase}.` }
}
