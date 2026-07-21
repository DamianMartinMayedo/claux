// Lógica y tipos PUROS de suscripciones (sin 'use server'): compartidos por las
// acciones del portal (suscripciones.ts) y por la ficha del tercero (terceros.ts).
// «Vencida» NO se guarda en BD: se DERIVA aquí (estadoEfectivo), como CLAUX deriva
// los estados de las facturas. Ver docs/planes/modulo-servicios.md.

export type PeriodicidadSub = 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL'
export type EstadoSub       = 'ACTIVA' | 'PAUSADA' | 'CANCELADA'
/** El estado que se muestra: los almacenados + «VENCIDA», derivada. */
export type EstadoEfectivo  = EstadoSub | 'VENCIDA'
/** Mismo vocabulario que los ajustes de las facturas (`documento_ajustes.modo`). */
export type DescuentoModo   = 'PORCENTAJE' | 'MONTO_FIJO'

export const PERIODICIDADES: PeriodicidadSub[] = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL']

/** Cuántos meses cubre cada cobro. Es lo que convierte el precio mensual en importe. */
export const MESES_PERIODO: Record<PeriodicidadSub, number> = {
  MENSUAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12,
}

function redondear2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/**
 * Lo que se le cobra al cliente en CADA cobro, desglosado.
 *
 * El precio se guarda SIEMPRE por mes; el importe del ciclo se calcula. Así «10.000
 * CUP» significa lo mismo en todas las suscripciones y comparar dos clientes no exige
 * mirar también su periodicidad. El descuento es el clásico «si me lo pagas al año, te
 * hago precio», y por eso se aplica sobre el importe del ciclo, no sobre el mes.
 *
 * Nunca sale negativo: un descuento fijo mayor que el importe deja el cobro a 0, no en
 * números rojos — cobrar «menos que nada» no existe, y colarlo en una factura sí.
 */
export function calcularCobro(
  precioMensual: number,
  periodicidad:  PeriodicidadSub,
  descuentoModo: DescuentoModo = 'PORCENTAJE',
  descuentoValor = 0,
): { meses: number; bruto: number; descuento: number; total: number; equivalenteMensual: number } {
  const meses = MESES_PERIODO[periodicidad] ?? 1
  const bruto = redondear2((Number(precioMensual) || 0) * meses)

  const valor = Number(descuentoValor) || 0
  const descuento = valor <= 0 ? 0 : redondear2(
    descuentoModo === 'PORCENTAJE' ? bruto * Math.min(valor, 100) / 100 : Math.min(valor, bruto),
  )

  const total = redondear2(bruto - descuento)
  return { meses, bruto, descuento, total, equivalenteMensual: redondear2(total / meses) }
}

/** Una línea para calcular su cobro: su precio mensual y su propio descuento (mig. 125). */
export interface LineaCobro {
  precio_mensual: number
  descuento_modo: DescuentoModo
  descuento_valor: number
}

/**
 * Cobro del ACUERDO entero = la suma del cobro de cada servicio, cada uno con SU
 * descuento (mig. 125). Antes el descuento era único del acuerdo; ahora es por línea, así
 * que el total se suma línea a línea en vez de aplicar un descuento sobre la base común.
 */
export function calcularCobroAcuerdo(
  lineas: LineaCobro[], periodicidad: PeriodicidadSub,
): { meses: number; bruto: number; descuento: number; total: number; equivalenteMensual: number } {
  const meses = MESES_PERIODO[periodicidad] ?? 1
  let bruto = 0, descuento = 0, total = 0
  for (const l of lineas) {
    const c = calcularCobro(l.precio_mensual, periodicidad, l.descuento_modo, l.descuento_valor)
    bruto += c.bruto; descuento += c.descuento; total += c.total
  }
  bruto = redondear2(bruto); descuento = redondear2(descuento); total = redondear2(total)
  return { meses, bruto, descuento, total, equivalenteMensual: meses ? redondear2(total / meses) : total }
}

/**
 * Un servicio dentro del acuerdo. El precio es SUYO; el descuento, la moneda, la
 * periodicidad y las fechas son del acuerdo (mig. 124).
 */
export interface SuscripcionLinea {
  linea_id:       string
  producto_id:    string
  /** SIEMPRE por mes. El importe del ciclo se calcula (`calcularCobro`). */
  precio_mensual: number
  /** El descuento es de CADA servicio (mig. 125), no del acuerdo. */
  descuento_modo:  DescuentoModo
  descuento_valor: number
}

export interface SuscripcionLineaRow extends SuscripcionLinea {
  servicio_nombre: string
}

/** Lo que suma al mes un acuerdo: la base sobre la que se calcula cada cobro. */
export function sumaMensual(lineas: { precio_mensual: number }[]): number {
  return redondear2(lineas.reduce((t, l) => t + (Number(l.precio_mensual) || 0), 0))
}

export interface Suscripcion {
  suscripcion_id:        string
  client_id:             string
  empresa_id:            string
  cliente_id:            string
  moneda:                string
  periodicidad:          PeriodicidadSub
  fecha_inicio:          string
  fecha_proximo_cobro:   string
  fecha_fin:             string | null
  renovacion_automatica: boolean
  estado:                EstadoSub
  notas:                 string | null
  created_at:            string
  updated_at:            string
}

export interface SuscripcionRow extends Suscripcion {
  cliente_nombre:  string
  lineas:          SuscripcionLineaRow[]
  estado_efectivo: EstadoEfectivo
}

export interface ServicioSuscribible {
  producto_id:          string
  nombre:               string
  precios:              Record<string, number>
  periodicidad_defecto: PeriodicidadSub | null
}

export interface SuscripcionesPageData {
  suscripciones: SuscripcionRow[]
  /** Con su empresa: los terceros son por empresa, y el selector filtra por la elegida. */
  clientes:      { tercero_id: string; nombre: string; empresa_id: string }[]
  servicios:     ServicioSuscribible[]
  monedas:       string[]
  empresas:      { empresa_id: string; nombre: string; letra_facturacion: string | null }[]
  /**
   * Factores de conversión entre las monedas del cliente ("ORIGEN__DESTINO" → factor),
   * para ofrecer la tasa como atajo cuando el servicio no tiene tarifa en la moneda
   * elegida. Mismo mapa que usa Personal con el salario.
   */
  tasas:         Record<string, number>
  /** ¿Tiene Contabilidad? La facturación del período es real con ella, informativa sin. */
  tieneBase:     boolean
}

// ── Facturación del período (Fase D) ──────────────────────────────────────────

export interface FacturacionLinea {
  suscripcion_id:  string
  /** La línea del acuerdo que la origina (mig. 124). */
  linea_id:        string
  producto_id:     string
  servicio_nombre: string
  cantidad:        number
  /** Lo que se cobra por ESTE servicio: ya calculado (meses del ciclo − su descuento). */
  precio:          number
  // Desglose, para que la tabla explique de dónde sale el importe en vez de soltar
  // un número: «3 meses × 10.000 − 10 %».
  meses:           number
  bruto:           number
  descuento:       number
  /**
   * El descuento del acuerdo como PORCENTAJE efectivo (descuento/bruto). Así se
   * reparte exacto entre las líneas de la factura sin prorrateos a mano, y de paso
   * queda a la vista en cada línea en vez de escondido en el total.
   */
  descuento_pct:   number
  periodicidad:    PeriodicidadSub
}
/** Una factura futura: un cliente + una moneda + sus líneas. */
export interface FacturacionGrupo {
  cliente_id:     string
  cliente_nombre: string
  moneda:         string
  lineas:         FacturacionLinea[]
  total:          number
}
/**
 * Una factura del período que YA cubre suscripciones. Es el rastro que impide volver a
 * cobrarlas, y se devuelve para poder enseñarlo: sin esto, un período ya facturado se
 * veía igual que uno sin nada que cobrar, y el dueño no sabía si el sistema había hecho
 * su trabajo o se le había olvidado.
 */
export interface FacturaDelPeriodo {
  factura_id:     string
  numero:         string
  cliente_nombre: string
  moneda:         string
  total:          number
  estado:         string
  /** Cuántas suscripciones cubre esa factura. */
  suscripciones:  number
}
export interface FacturacionPreview {
  periodo:              string   // 'YYYY-MM'
  empresa_id:           string
  grupos:               FacturacionGrupo[]
  /** Clientes con suscripciones en varias monedas → saldrán varias facturas. */
  clientesMultimoneda:  string[]
  /** Lo ya facturado de este período (borradores automáticos incluidos). */
  yaFacturadas:         FacturaDelPeriodo[]
}

// ── Calendario de cobros ──────────────────────────────────────────────────────

/**
 * En qué momento está el cobro de un mes:
 *  - `FACTURADO`  — ya tiene su factura (borrador incluido). Se enseña y se enlaza.
 *  - `PENDIENTE`  — toca ya (este mes o atrasado). Es lo único accionable.
 *  - `PROYECTADO` — futuro. **Informativo y sin acciones**: no existe hasta que se
 *    genere el borrador, y facturar por adelantado dejaría la factura fuera de su
 *    período y una cuenta por cobrar fantasma.
 */
export type EstadoCobro = 'FACTURADO' | 'PENDIENTE' | 'PROYECTADO'

export interface MesCalendario {
  periodo:  string            // 'YYYY-MM'
  /** El del mes: PENDIENTE si algo queda por generar, si no FACTURADO, si no PROYECTADO. */
  estado:   EstadoCobro
  /** Lo que se cobraría (pendiente o proyectado); vacío si el mes está cerrado. */
  grupos:   FacturacionGrupo[]
  /** Lo ya facturado de ese mes. */
  facturas: FacturaDelPeriodo[]
  /** Un total por moneda: sumar CUP con USD no significa nada. */
  totales:  { moneda: string; total: number }[]
  /** Clientes con varias monedas ese mes → saldrá una factura por moneda. */
  clientesMultimoneda: string[]
}

export interface CalendarioFacturacion {
  empresa_id: string
  /** Mes en curso, para separar lo que toca de lo que viene. */
  mesActual:  string
  /** Meses con algo que enseñar, en orden: primero lo atrasado, al final lo futuro. */
  meses:      MesCalendario[]
}

/** Suscripciones activas de un cliente, para su ficha de tercero. */
export interface TerceroSuscripcion {
  suscripcion_id:      string
  /** Los servicios del acuerdo, ya resueltos a nombre. */
  servicios:           string[]
  /** Lo que se le cobra cada ciclo, ya calculado. */
  importe_cobro:       number
  moneda:              string
  periodicidad:        PeriodicidadSub
  fecha_proximo_cobro: string
  estado_efectivo:     EstadoEfectivo
}

export function hoyStr(): string {
  return new Date().toISOString().split('T')[0]
}

/** Suma una periodicidad a una fecha 'YYYY-MM-DD' (en UTC, sin tocar la zona). */
export function sumarPeriodo(fecha: string, per: PeriodicidadSub): string {
  const meses = { MENSUAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 }[per]
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, (m - 1) + meses, d)).toISOString().split('T')[0]
}

/** Resta una periodicidad. Sirve para deshacer el avance al anular una factura. */
export function restarPeriodo(fecha: string, per: PeriodicidadSub): string {
  const meses = { MENSUAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 }[per]
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, (m - 1) - meses, d)).toISOString().split('T')[0]
}

/**
 * «Vencida» NO se guarda: se deriva. Una suscripción ACTIVA con fecha_fin pasada y
 * SIN renovación automática está vencida. El resto de estados se muestran tal cual.
 */
export function estadoEfectivo(
  s: Pick<Suscripcion, 'estado' | 'fecha_fin' | 'renovacion_automatica'>,
  hoy: string = hoyStr(),
): EstadoEfectivo {
  if (s.estado !== 'ACTIVA') return s.estado
  if (s.fecha_fin && !s.renovacion_automatica && s.fecha_fin < hoy) return 'VENCIDA'
  return 'ACTIVA'
}

export function generarSuscripcionId(): string {
  return `SUS-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

export function generarLineaId(): string {
  return `SLN-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
