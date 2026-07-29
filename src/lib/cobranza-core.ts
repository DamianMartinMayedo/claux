// Núcleo de cobranza (sin 'use server'): el cálculo del SALDO y del TRAMO de
// vencimiento de un documento.
//
// Vive fuera de `actions/portal/cobranza.ts` porque ahora lo usan dos pantallas y
// tienen que decir lo mismo:
//   · CxC / CxP (`cargarCuentas`) — la lista de lo que se debe.
//   · Ventas (`obtenerVentasResumen`) — las columnas «Pendiente» y «Vencida» del
//     listado de facturas, que antes no existían: para saber si una factura estaba
//     cobrada había que salir a otra pantalla.
// Con una copia por sitio, la misma factura acabaría apareciendo vencida en una y al
// día en la otra, y el dueño no sabría a cuál creer.

export type Tramo = 'AL_DIA' | 'V_1_30' | 'V_31_60' | 'V_60'

/** Margen de redondeo: dos céntimos de diferencia no son una deuda. */
export const EPS_SALDO = 0.005

export function diasEntre(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split('T')[0].split('-').map(Number)
  const [y2, m2, d2] = hasta.split('T')[0].split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

/**
 * Tramo de aging de un documento. Sin fecha de vencimiento nunca está vencido: no se
 * inventa un plazo que nadie pactó.
 */
export function tramoDe(
  vencimiento: string | null, hoy: string,
): { dias: number | null; tramo: Tramo } {
  if (!vencimiento || vencimiento.split('T')[0] >= hoy) return { dias: null, tramo: 'AL_DIA' }
  const dias = diasEntre(vencimiento, hoy)
  if (dias <= 30) return { dias, tramo: 'V_1_30' }
  if (dias <= 60) return { dias, tramo: 'V_31_60' }
  return { dias, tramo: 'V_60' }
}

export interface EstadoCobro {
  liquidado: number
  saldo:     number
  /** Hay cobros pero queda saldo. Es DERIVADO: el estado persistido sigue siendo
   *  EMITIDA, igual que en Gastos y cobros. */
  parcial:   boolean
  dias_vencido: number | null
  tramo:     Tramo
}

/**
 * Estado de cobro de un documento a partir de su total y de lo liquidado.
 *
 * `liquidado` se mide en la moneda DEL DOCUMENTO (`monto_ref` del movimiento), no en la
 * de la caja: pagar 100 USD desde una caja en CUP reduce el saldo en 100 USD, y sumar el
 * importe de la caja dejaría el documento pagado de más o de menos según la tasa.
 */
export function estadoCobro(
  total: number, liquidado: number, vencimiento: string | null, hoy: string,
): EstadoCobro {
  const t = Number(total) || 0
  const l = Number(liquidado) || 0
  const saldo = Math.max(0, t - l)
  const { dias, tramo } = tramoDe(vencimiento, hoy)
  return {
    liquidado: l,
    saldo,
    parcial: l > EPS_SALDO && saldo > EPS_SALDO,
    dias_vencido: saldo > EPS_SALDO ? dias : null,   // lo cobrado ya no vence
    tramo:        saldo > EPS_SALDO ? tramo : 'AL_DIA',
  }
}
