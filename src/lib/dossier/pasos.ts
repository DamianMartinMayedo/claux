// ── Pasos editables del dossier (definición compartida) ─────────────────────
// La MISMA lista la recorren el wizard (creación, lineal) y «Mi dossier»
// (mantenimiento, navegación libre). Una sola fuente para que sus etiquetas y su
// orden no deriven. El wizard añade su paso final 'listo' aparte.

export type PasoEditable =
  | 'basicos' | 'costos' | 'numeros' | 'desglose' | 'crecimiento' | 'relato' | 'marca'

export const LABEL_PASO: Record<PasoEditable, string> = {
  basicos:     'Lo básico',
  costos:      'Coste de ventas',
  numeros:     'Los números',
  desglose:    'El desglose',
  crecimiento: 'Crecimiento',
  relato:      'El relato',
  marca:       'La marca',
}

/**
 * Pasos en orden. Sin `base`, el coste de ventas no se pregunta (es una columna
 * más de la rejilla), así que ese paso no existe.
 *
 * `desglose` SÍ existe siempre, y es lo que arregla el hueco de la vía manual: la
 * rejilla da totales y márgenes por mes, pero nunca dice EN QUÉ se va el dinero —
 * que es justo la pregunta del inversor. Va detrás de 'numeros' porque se concilia
 * contra sus totales: sin ellos no hay contra qué cuadrar.
 */
export function pasosEditables(tieneBase: boolean): PasoEditable[] {
  const costos: PasoEditable[] = tieneBase ? ['costos'] : []
  return ['basicos', ...costos, 'numeros', 'desglose', 'crecimiento', 'relato', 'marca']
}
