// ── Consumo y cobertura ──
//
// Lo que convierte el módulo de registro en herramienta de decisión, y no necesita
// IA: es aritmética sobre el ledger que ya existe. «Tengo 40 kg» no dice nada;
// «tengo 40 kg y me duran 6 días» decide la compra.
//
// Puro y fuera de cualquier fichero 'use server'.

/** Días de historia que se miran. Un trimestre absorbe la estacionalidad de un mes. */
export const DIAS_VENTANA = 90
/** Menos historia que esto y no se estima: ver `diasDeCobertura`. */
const DIAS_MINIMOS = 30
/** Menos movimientos que estos y tampoco: una sola venta no es un ritmo. */
const MOVIMIENTOS_MINIMOS = 3

export interface MovimientoConsumo {
  producto_id:        string
  almacen_id:         string
  almacen_destino_id: string | null
  tipo:               'ENTRADA' | 'SALIDA' | 'AJUSTE' | 'TRANSFERENCIA'
  origen:             'MANUAL' | 'COMPRA' | 'VENTA'
  cantidad:           number
  fecha:              string
}

export interface Consumo {
  /** Unidades que salen al día, de media, en la ventana. */
  diario:      number
  movimientos: number
  /** Días entre el primer y el último movimiento contados (no la ventana entera). */
  diasHistoria: number
}

/**
 * Consumo diario por `producto@almacen`.
 *
 * Cuenta como consumo lo que SALE de verdad: las SALIDA y la pata saliente de una
 * TRANSFERENCIA, de origen `VENTA` o `MANUAL`. NO cuentan:
 *   · las ENTRADA ni las compras (eso es reposición, no consumo);
 *   · los AJUSTE (son correcciones de conteo: contarlos como consumo convertiría un
 *     descuadre en «se vende muchísimo»);
 *   · la pata ENTRANTE de una transferencia (para el almacén destino es reposición).
 */
export function consumoDiario(
  movimientos: MovimientoConsumo[],
  dias: number = DIAS_VENTANA,
): Map<string, Consumo> {
  const acumulado = new Map<string, { unidades: number; movimientos: number; min: string; max: string }>()

  for (const m of movimientos) {
    if (m.origen === 'COMPRA') continue
    if (m.tipo === 'ENTRADA' || m.tipo === 'AJUSTE') continue
    if (m.tipo !== 'SALIDA' && m.tipo !== 'TRANSFERENCIA') continue

    const clave = `${m.producto_id}@${m.almacen_id}`   // siempre el almacén de ORIGEN
    const cant  = Math.abs(Number(m.cantidad))
    if (cant <= 0) continue

    const prev = acumulado.get(clave)
    if (!prev) {
      acumulado.set(clave, { unidades: cant, movimientos: 1, min: m.fecha, max: m.fecha })
    } else {
      prev.unidades   += cant
      prev.movimientos += 1
      if (m.fecha < prev.min) prev.min = m.fecha
      if (m.fecha > prev.max) prev.max = m.fecha
    }
  }

  const out = new Map<string, Consumo>()
  for (const [clave, a] of acumulado) {
    // El divisor es la ventana, no el hueco entre el primer y el último movimiento:
    // si en 90 días solo se vendió una semana, el ritmo real es bajo, no alto.
    out.set(clave, {
      diario:       a.unidades / dias,
      movimientos:  a.movimientos,
      diasHistoria: Math.round((new Date(a.max).getTime() - new Date(a.min).getTime()) / 86_400_000) + 1,
    })
  }
  return out
}

/**
 * Días que duran `cantidad` unidades al ritmo de `consumo`.
 *
 * Devuelve `null` cuando NO hay con qué estimar: sin consumo, con menos de 30 días
 * de historia o con menos de 3 movimientos. Un «te quedan 2 días» calculado sobre
 * una sola venta es peor que no decir nada — misma regla que el P&L progresivo.
 */
export function diasDeCobertura(cantidad: number, consumo: Consumo | undefined): number | null {
  if (!consumo || consumo.diario <= 0) return null
  if (consumo.diasHistoria < DIAS_MINIMOS) return null
  if (consumo.movimientos < MOVIMIENTOS_MINIMOS) return null
  if (cantidad <= 0) return 0
  return Math.floor(cantidad / consumo.diario)
}

/** Etiqueta corta y honesta: siempre se lee como estimación, nunca como compromiso. */
export function etiquetaCobertura(dias: number | null): string {
  if (dias == null) return '—'
  if (dias === 0)   return 'agotado'
  if (dias === 1)   return '1 día'
  if (dias > 365)   return '+1 año'
  return `${dias} días`
}
