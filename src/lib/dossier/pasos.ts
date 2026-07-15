// ── Pasos editables del dossier (definición compartida) ─────────────────────
// La MISMA lista la recorren el wizard (creación, lineal) y «Mi dossier»
// (mantenimiento, navegación libre). Una sola fuente para que sus etiquetas y su
// orden no deriven. El wizard añade su paso final 'listo' aparte.

export type PasoEditable = 'basicos' | 'costos' | 'numeros' | 'crecimiento' | 'relato' | 'marca'

export const LABEL_PASO: Record<PasoEditable, string> = {
  basicos:     'Lo básico',
  costos:      'Coste de ventas',
  numeros:     'Los números',
  crecimiento: 'Crecimiento',
  relato:      'El relato',
  marca:       'La marca',
}

/**
 * Pasos en orden. Sin `base`, el coste de ventas no se pregunta (es una columna
 * más de la rejilla), así que ese paso no existe.
 */
export function pasosEditables(tieneBase: boolean): PasoEditable[] {
  const costos: PasoEditable[] = tieneBase ? ['costos'] : []
  return ['basicos', ...costos, 'numeros', 'crecimiento', 'relato', 'marca']
}
