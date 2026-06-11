// ────────────────────────────────────────────────────────────────────────────
// Helpers compartidos del módulo Ventas
// Archivo SIN 'use server': contiene tipos y constantes consumidos tanto por
// componentes cliente como por server actions.
// ────────────────────────────────────────────────────────────────────────────

export type EstadoOferta  = 'BORRADOR' | 'ENVIADA' | 'APROBADA' | 'RECHAZADA' | 'CADUCADA'
export type EstadoFactura = 'BORRADOR' | 'EMITIDA' | 'COBRADA' | 'ANULADA'
export type DocumentoTipo = 'OFERTA' | 'FACTURA'
export type AjusteTipo    = 'DESCUENTO' | 'CARGO' | 'IMPUESTO'
export type AjusteModo    = 'PORCENTAJE' | 'MONTO_FIJO'

// ── Etiquetas ─────────────────────────────────────────────────────────────────

export const ESTADO_OFERTA_LABEL: Record<EstadoOferta, string> = {
  BORRADOR:  'Borrador',
  ENVIADA:   'Enviada',
  APROBADA:  'Aprobada',
  RECHAZADA: 'Rechazada',
  CADUCADA:  'Caducada',
}

export const ESTADO_FACTURA_LABEL: Record<EstadoFactura, string> = {
  BORRADOR: 'Borrador',
  EMITIDA:  'Emitida',
  COBRADA:  'Cobrada',
  ANULADA:  'Anulada',
}

export const ESTADO_OFERTA_STYLE: Record<EstadoOferta, { bg: string; color: string }> = {
  BORRADOR:  { bg: '#f1f5f9', color: '#475569' },
  ENVIADA:   { bg: '#dbeafe', color: '#1d4ed8' },
  APROBADA:  { bg: '#dcfce7', color: '#166534' },
  RECHAZADA: { bg: '#fee2e2', color: '#b91c1c' },
  CADUCADA:  { bg: '#fef3c7', color: '#92400e' },
}

export const ESTADO_FACTURA_STYLE: Record<EstadoFactura, { bg: string; color: string }> = {
  BORRADOR: { bg: '#f1f5f9', color: '#475569' },
  EMITIDA:  { bg: '#dbeafe', color: '#1d4ed8' },
  COBRADA:  { bg: '#dcfce7', color: '#166534' },
  ANULADA:  { bg: '#fee2e2', color: '#b91c1c' },
}

export const AJUSTE_TIPO_LABEL: Record<AjusteTipo, string> = {
  DESCUENTO: 'Descuento',
  CARGO:     'Cargo',
  IMPUESTO:  'Impuesto',
}

export const AJUSTE_TIPO_STYLE: Record<AjusteTipo, { bg: string; color: string }> = {
  DESCUENTO: { bg: '#fef3c7', color: '#92400e' },
  CARGO:     { bg: '#e0e7ff', color: '#3730a3' },
  IMPUESTO:  { bg: '#fce7f3', color: '#9d174d' },
}

export const CONDICION_PAGO_LABEL: Record<string, string> = {
  CONTADO: 'Contado',
  '15':    '15 días',
  '30':    '30 días',
  '45':    '45 días',
  '60':    '60 días',
  '90':    '90 días',
}

export const CONDICION_PAGO_OPTIONS = [
  { value: 'CONTADO', label: 'Contado' },
  { value: '15',      label: '15 días' },
  { value: '30',      label: '30 días' },
  { value: '45',      label: '45 días' },
  { value: '60',      label: '60 días' },
  { value: '90',      label: '90 días' },
]

// ── Transiciones de estado permitidas ─────────────────────────────────────────

export const TRANSICIONES_OFERTA: Record<EstadoOferta, EstadoOferta[]> = {
  BORRADOR:  ['ENVIADA', 'APROBADA', 'RECHAZADA'],
  ENVIADA:   ['APROBADA', 'RECHAZADA', 'CADUCADA', 'BORRADOR'],
  APROBADA:  [],   // terminal: ya generó factura
  RECHAZADA: ['BORRADOR'],
  CADUCADA:  ['BORRADOR'],
}

export const TRANSICIONES_FACTURA: Record<EstadoFactura, EstadoFactura[]> = {
  BORRADOR: ['EMITIDA', 'ANULADA'],
  EMITIDA:  ['COBRADA', 'ANULADA'],
  COBRADA:  ['ANULADA'],
  ANULADA:  [],
}

// ── Cálculos ─────────────────────────────────────────────────────────────────

export interface LineaInput {
  producto_id:     string | null
  descripcion:     string
  cantidad:        number
  precio_unitario: number
  descuento_pct:   number   // 0–100; descuento a nivel de línea
}

export interface AjusteInput {
  tipo:   AjusteTipo
  nombre: string
  modo:   AjusteModo
  valor:  number
}

export interface TotalesCalculados {
  lineas_totales:    number[]     // neto por línea (después de descuento de línea)
  lineas_descuentos: number[]     // descuento_importe por línea
  subtotal:          number       // suma de netos
  ajustes_calculados: number[]    // monto_calculado por ajuste
  total:             number
}

/**
 * Calcula totales de un documento de venta.
 *
 * Reglas:
 *   linea.bruto        = cantidad × precio_unitario
 *   linea.descuento    = bruto × descuento_pct / 100
 *   linea.neto         = bruto − descuento
 *   subtotal           = sum(lineas.neto)
 *   ajuste.monto       = modo='PORCENTAJE' ? subtotal × valor/100 : valor
 *   total              = subtotal − sum(DESCUENTOS) + sum(CARGOS + IMPUESTOS)
 *
 * Los porcentajes de ajuste se aplican siempre sobre el subtotal (no acumulado).
 */
export function calcularTotales(
  lineas:  LineaInput[],
  ajustes: AjusteInput[],
): TotalesCalculados {
  const lineas_brutos    = lineas.map(l =>
    redondear((Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0)),
  )
  const lineas_descuentos = lineas.map((l, i) =>
    redondear(lineas_brutos[i] * (Number(l.descuento_pct) || 0) / 100),
  )
  const lineas_totales = lineas.map((_, i) =>
    redondear(lineas_brutos[i] - lineas_descuentos[i]),
  )
  const subtotal = redondear(lineas_totales.reduce((a, b) => a + b, 0))

  const ajustes_calculados = ajustes.map(a => {
    const v = Number(a.valor) || 0
    return redondear(a.modo === 'PORCENTAJE' ? (subtotal * v) / 100 : v)
  })

  let total = subtotal
  ajustes.forEach((a, i) => {
    const m = ajustes_calculados[i]
    total += a.tipo === 'DESCUENTO' ? -m : m
  })

  return { lineas_totales, lineas_descuentos, subtotal, ajustes_calculados, total: redondear(total) }
}

export function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function formatearMoneda(monto: number, moneda: string): string {
  const formateado = monto.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${formateado} ${moneda}`
}

// ── Formato de número de documento ────────────────────────────────────────────

export function formatoNumero(
  tipo:      DocumentoTipo,
  letra:     string,
  anio:      number,
  numero:    number,
): string {
  const prefijo = tipo === 'OFERTA' ? 'OF' : 'F'
  return `${prefijo}${letra}${anio}${String(numero).padStart(4, '0')}`
}

// ── Cálculo de fecha de vencimiento desde condición de pago ───────────────────

export function calcularFechaVencimiento(
  condicion:    string,
  fechaEmision: string,
): string {
  if (!fechaEmision) return ''
  if (condicion === 'CONTADO' || !condicion) return fechaEmision
  const dias = parseInt(condicion) || 0
  const d    = new Date(fechaEmision)
  d.setDate(d.getDate() + dias)
  return d.toISOString().substring(0, 10)
}
