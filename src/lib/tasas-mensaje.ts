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

// ── Antigüedad de una tasa ───────────────────────────────────────────────────
//
// La misma en TODAS partes: el widget del dashboard y la tabla de Monedas hablan
// de la misma tasa, y si una dice «hace 3 d» y la otra enseña una fecha suelta,
// el dueño tiene que restar de cabeza para saber si puede fiarse del número.
//
// Se calcula en el SERVIDOR y viaja ya resuelta: pedirle la fecha de hoy al
// navegador dentro de un componente cliente da una cosa en el SSR y otra tras
// hidratar (§skills/ui, gotcha del reloj).

/** A partir de aquí la tasa ya no representa el mercado. Criterio de producto
 *  para la volatilidad cubana, no un número mágico del cambio: quincena. */
export const DIAS_TASA_VIEJA = 15

/** Días entre una fecha 'YYYY-MM-DD' y hoy. UTC en las dos, sin saltos por huso. */
export function diasDeTasa(fecha: string | null | undefined, hoy: string): number | null {
  if (!fecha) return null
  const a = Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${hoy}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

/** «hoy» · «ayer» · «hace 5 d». Lo que se lee al lado de la tasa. */
export function edadTasa(dias: number | null | undefined): string {
  if (dias == null) return 'sin fecha'
  if (dias === 0)   return 'hoy'
  if (dias === 1)   return 'ayer'
  return `hace ${dias} d`
}

/** ¿Hay que avisar de que esta tasa ya no vale? */
export function tasaVieja(dias: number | null | undefined): boolean {
  return dias != null && dias >= DIAS_TASA_VIEJA
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
