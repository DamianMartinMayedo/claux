// ── Reglas de reconocimiento contable (compartidas) ─────────────────────────
// Constantes que definen QUÉ cuenta como ingreso/gasto en la base. Viven aquí
// (módulo normal, no 'use server') para que reportes, dashboard y el dossier
// las importen de un solo sitio y no deriven. Si un día "EMITIDA|COBRADA" cambia,
// cambia en un lugar.

/**
 * Estados de factura que cuentan como ingreso devengado (estado de resultados).
 * Una factura EMITIDA ya es ingreso reconocido; COBRADA además está liquidada.
 */
export const ESTADOS_FACTURA_INGRESO = ['EMITIDA', 'COBRADA'] as const

export type EstadoFacturaIngreso = (typeof ESTADOS_FACTURA_INGRESO)[number]

/**
 * Estados de compra que cuentan como gasto/volumen real con el proveedor.
 * Simétrico a ESTADOS_FACTURA_INGRESO: BORRADOR aún no es un compromiso y
 * ANULADA dejó de serlo; solo CONFIRMADA es dinero comprometido.
 */
export const ESTADOS_COMPRA_GASTO = ['CONFIRMADA'] as const

export type EstadoCompraGasto = (typeof ESTADOS_COMPRA_GASTO)[number]
