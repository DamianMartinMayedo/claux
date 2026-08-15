// Periodicidad de un artículo del Catálogo digital (menú QR). Fuente ÚNICA del
// sufijo del precio y de las opciones del selector — antes vivía duplicado en la
// vista pública, el detalle público y (faltaba) el editor, y cada copia podía
// decir algo distinto. El sufijo cambia el SENTIDO del precio ante el cliente
// final: «2.000 CUP» a secas ≠ «2.000 CUP/mes» (mig. 162).
import { PERIODICIDADES, type PeriodicidadSub } from '@/lib/suscripciones'

export const SUFIJO_PERIODO: Record<string, string> = {
  MENSUAL: '/mes', TRIMESTRAL: '/trimestre', SEMESTRAL: '/semestre', ANUAL: '/año',
}

/** Etiqueta humana de cada periodicidad, para el selector del editor. */
export const ETIQUETA_PERIODO: Record<PeriodicidadSub, string> = {
  MENSUAL: 'Mensual', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual',
}

/** Opciones del `<select>` del editor: «Pago único» (NULL) + las cuatro recurrencias. */
export const OPCIONES_PERIODO: { valor: string; etiqueta: string }[] = [
  { valor: '', etiqueta: 'Pago único' },
  ...PERIODICIDADES.map(p => ({ valor: p, etiqueta: ETIQUETA_PERIODO[p] })),
]

/** Sufijo a mostrar tras el precio (« /mes »); '' si es pago único o desconocido. */
export function sufijoPeriodo(periodicidad: string | null | undefined): string {
  return periodicidad ? (SUFIJO_PERIODO[periodicidad] ?? '') : ''
}
