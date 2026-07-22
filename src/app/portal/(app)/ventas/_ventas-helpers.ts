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

// Etiqueta de la ACCIÓN que lleva a cada estado (verbo directo), NO el nombre del
// estado. Fuente única: la usan tanto el menú del detalle como la barra en lote, para
// que la misma acción no se llame «Emitir» en un sitio y «Cambiar a Emitida» en otro.
export const ACCION_OFERTA_LABEL: Record<EstadoOferta, string> = {
  BORRADOR:  'Reabrir',
  ENVIADA:   'Enviar',
  APROBADA:  'Aprobar',
  RECHAZADA: 'Rechazar',
  CADUCADA:  'Caducar',
}

export const ACCION_FACTURA_LABEL: Record<EstadoFactura, string> = {
  BORRADOR: 'Reabrir',
  EMITIDA:  'Emitir',
  COBRADA:  'Cobrar',   // el cobro va por «Registrar cobro»; no aparece en el menú
  ANULADA:  'Anular',
}

export const ESTADO_OFERTA_BADGE: Record<EstadoOferta, string> = {
  BORRADOR:  'badge-neutral',
  ENVIADA:   'badge-info',
  APROBADA:  'badge-success',
  RECHAZADA: 'badge-error',
  CADUCADA:  'badge-warning',
}

export const ESTADO_FACTURA_BADGE: Record<EstadoFactura, string> = {
  BORRADOR: 'badge-neutral',
  EMITIDA:  'badge-info',
  COBRADA:  'badge-success',
  ANULADA:  'badge-error',
}

export const AJUSTE_TIPO_LABEL: Record<AjusteTipo, string> = {
  DESCUENTO: 'Descuento',
  CARGO:     'Cargo',
  IMPUESTO:  'Impuesto',
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
  EMITIDA:  ['ANULADA'],              // COBRADA solo vía "Registrar cobro" (crea movimiento en tesorería)
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
  /** Suscripción de origen, si la línea la generó la facturación del período. */
  suscripcion_id?: string | null
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

// ── Cambio de moneda del documento ───────────────────────────────────────────

/**
 * ¿Hay algún importe que reexpresar? Un documento vacío (o con todo a cero) puede
 * cambiar de moneda sin preguntar nada: no hay nada que convertir.
 */
export function tieneImportes(lineas: LineaInput[], ajustes: AjusteInput[]): boolean {
  return lineas.some(l => (Number(l.precio_unitario) || 0) !== 0)
      || ajustes.some(a => a.modo === 'MONTO_FIJO' && (Number(a.valor) || 0) !== 0)
}

/** Lo que hace falta de un artículo para reexpresar una línea: su tarifa por moneda. */
export interface PrecioCatalogo {
  producto_id: string
  precios:     Record<string, number>
}

export interface PlanCambioMoneda {
  lineas:     LineaInput[]
  ajustes:    AjusteInput[]
  /** Líneas que toman su precio configurado en la moneda destino. */
  nCatalogo:  number
  /** Importes reexpresados con la tasa (los que no tienen precio configurado). */
  nTasa:      number
  /** Importes con valor que no se han podido reexpresar: ni tarifa ni tasa. */
  nIntactos:  number
}

/**
 * Prepara el cambio de moneda de un documento. Tres destinos por importe, en este
 * orden de prioridad:
 *
 *  1. **Tarifa del catálogo.** Si la línea está enlazada a un artículo que YA tiene
 *     precio configurado en la moneda destino, se usa ese. Es lo que el negocio
 *     decidió cobrar en esa moneda, y casi nunca coincide con aplicar la tasa a la
 *     tarifa de otra (los precios se redondean a cifras vendibles: 25 USD, no 24,87).
 *  2. **Tasa vigente**, para lo que no tiene tarifa propia: líneas de texto libre,
 *     artículos sin precio en esa moneda y los ajustes de MONTO_FIJO.
 *  3. **Intacto**, si no hay ni tarifa ni tasa. No se inventa un factor: se deja el
 *     número y se avisa, que un importe que no cuadra se ve y uno inventado no.
 *
 * Los ajustes en PORCENTAJE nunca se tocan: son relativos al subtotal y ya viajan
 * convertidos por definición (un 10% sigue siendo un 10%). Multiplicarlos los
 * aplicaría dos veces.
 *
 * Todo queda editable después: esto es un atajo, no la verdad. Mismo criterio que el
 * salario en RRHH (`PersonalView`), donde la conversión se ofrece y no se impone.
 */
export function planificarCambioMoneda(
  lineas:    LineaInput[],
  ajustes:   AjusteInput[],
  destino:   string,
  factor:    number | undefined,
  productos: PrecioCatalogo[],
): PlanCambioMoneda {
  const tarifas = new Map(productos.map(p => [p.producto_id, p.precios]))
  let nCatalogo = 0, nTasa = 0, nIntactos = 0

  const nuevasLineas = lineas.map(l => {
    const actual  = Number(l.precio_unitario) || 0
    const tarifa  = l.producto_id ? tarifas.get(l.producto_id)?.[destino] : undefined
    // `!= null` y no truthy: un artículo con tarifa 0 en esa moneda (una muestra, un
    // servicio incluido) tiene precio configurado y vale 0. Con `if (tarifa)` se
    // habría colado en la rama de la tasa y salido convertido desde otra moneda.
    if (tarifa != null && Number.isFinite(tarifa)) {
      nCatalogo++
      return { ...l, precio_unitario: redondear(Number(tarifa)) }
    }
    if (factor) {
      if (actual !== 0) nTasa++
      return { ...l, precio_unitario: redondear(actual * factor) }
    }
    if (actual !== 0) nIntactos++
    return l
  })

  const nuevosAjustes = ajustes.map(a => {
    if (a.modo !== 'MONTO_FIJO') return a
    const actual = Number(a.valor) || 0
    if (factor) {
      if (actual !== 0) nTasa++
      return { ...a, valor: redondear(actual * factor) }
    }
    if (actual !== 0) nIntactos++
    return a
  })

  return { lineas: nuevasLineas, ajustes: nuevosAjustes, nCatalogo, nTasa, nIntactos }
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

// ── Número fiscal vs identificador provisional ────────────────────────────────
//
// Una factura recibe su correlativo al EMITIRSE, no al crearse. Mientras es borrador
// lleva un identificador de trabajo: así descartarla no deja un salto en la serie
// fiscal (que es lo primero que pregunta una inspección). Ver `factura-core.ts`.

const PREFIJO_PROVISIONAL = 'BORRADOR-'

/** Identificador de trabajo de un borrador: único porque sale del `factura_id`. */
export function numeroProvisional(documento_id: string): string {
  return `${PREFIJO_PROVISIONAL}${documento_id.split('-')[1] ?? documento_id}`
}

/** ¿Este documento sigue sin número fiscal? */
export function esNumeroProvisional(numero: string | null | undefined): boolean {
  return (numero ?? '').startsWith(PREFIJO_PROVISIONAL)
}

/**
 * Cómo se enseña. Del provisional se dice lo que ES —que aún no tiene número— en vez
 * de gritar «BORRADOR-» al lado de una insignia que ya dice «Borrador».
 */
export function etiquetaNumero(numero: string): string {
  return esNumeroProvisional(numero) ? `Sin número · ${numero.slice(PREFIJO_PROVISIONAL.length)}` : numero
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
