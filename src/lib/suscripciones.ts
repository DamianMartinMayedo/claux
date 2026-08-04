// Lógica y tipos PUROS de suscripciones (sin 'use server'): compartidos por las
// acciones del portal (suscripciones.ts) y por la ficha del tercero (terceros.ts).
// «Vencida» NO se guarda en BD: se DERIVA aquí (estadoEfectivo), como CLAUX deriva
// los estados de las facturas. Ver docs/planes/modulo-servicios.md.

// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: con `toISOString()` a partir de
// las 20:00 la fecha ya es la de mañana, así que un documento fechado de noche el último día
// del mes caía en el mes siguiente. Una sola fuente: `lib/fecha-tz.ts`.
import { hoyEnTz } from '@/lib/fecha-tz'

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
  // ── Ciclo de vida (mig. 161) ──
  /** Cuándo se pausó. Los ciclos que caen dentro de la pausa no se cobran. */
  pausada_desde:         string | null
  /** Reanudación programada. NULL = pausa indefinida. */
  pausada_hasta:         string | null
  /** Cuándo se canceló. `updated_at` no vale: lo pisa cualquier edición. */
  cancelada_at:          string | null
  /** La PRIMERA factura cobra solo los días del ciclo que se usan (mig. 163). */
  prorratear:            boolean
}

export interface SuscripcionRow extends Suscripcion {
  cliente_nombre:  string
  lineas:          SuscripcionLineaRow[]
  estado_efectivo: EstadoEfectivo
  /**
   * Sus facturas vivas, de la más reciente a la más antigua (`historialPorAcuerdo`). Es
   * lo que convierte el listado en la respuesta a «¿me pagaron?»: se despliega la fila y
   * ahí está el histórico, sin una página de detalle por acuerdo.
   */
  historial:       FacturaDeAcuerdo[]
  /**
   * Lo que se le debe de ESTE acuerdo, por moneda. **Vacío ≠ 0**: un acuerdo sin facturar
   * todavía no debe nada, y decir «0» sería la conclusión contraria.
   */
  debe:            { moneda: string; total: number }[]
}

/** Una factura del acuerdo (definida en `lib/facturacion-suscripciones.ts`). */
export interface FacturaDeAcuerdo {
  factura_id:    string
  numero:        string
  fecha_emision: string
  moneda:        string
  total:         number
  estado:        string
  saldo:         number
  acuerdos:      number
}

export interface ServicioSuscribible {
  producto_id:          string
  nombre:               string
  precios:              Record<string, number>
  periodicidad_defecto: PeriodicidadSub | null
  /**
   * Ya no se ofrece para acuerdos nuevos (archivado o desmarcado como suscribible), pero
   * viaja porque algún acuerdo vivo lo tiene contratado: sin él, editar ese acuerdo
   * pintaba «— Elige un servicio —» sobre una línea que SÍ tiene servicio, y guardar lo
   * borraba en silencio. Solo se ofrece en la línea que ya lo tenía (`opcionesCon`).
   */
  archivado:            boolean
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
  // ── Listado filtrado en la consulta (mismo contrato que Contabilidad) ──
  /** Rango realmente aplicado, sobre `fecha_proximo_cobro`. Vacío = sin rango. */
  rango:         { desde: string; hasta: string }
  /** Cuántos acuerdos hay DE VERDAD en el filtro (sin techo). */
  total:         number
  limite:        number
  /** Se alcanzó el techo: hay acuerdos fuera de la vista. */
  hay_mas:       boolean
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
  /**
   * Lo que queda por cobrar de ella, derivado de Tesorería (`lib/cobranza-core`), no
   * reimplementado: es el mismo saldo que enseñan CxC y el listado de Ventas. Un
   * borrador no debe nada todavía, así que su saldo es 0.
   */
  saldo:          number
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
 * En qué momento está el cobro de un mes. **Cinco estados y no tres**: con la
 * facturación automática siempre puesta, «FACTURADO» se ponía verde el día que corría el
 * cron y el trabajo que de verdad quedaba —emitir y cobrar— se volvía invisible desde la
 * única pantalla que existe para gestionar el cobro recurrente. Un cliente llegó a tener
 * 55 borradores sin emitir con el mes en verde.
 *
 *  - `PENDIENTE`  — queda algo por generar (toca ya o atrasado). Lo único accionable.
 *  - `BORRADOR`   — todo generado, nada emitido. Falta el acto del dueño.
 *  - `EMITIDO`    — emitido, con saldo por cobrar.
 *  - `COBRADO`    — todo saldado. **El verde se reserva a lo que de verdad terminó.**
 *  - `PROYECTADO` — futuro. **Informativo y sin acciones**: no existe hasta que se
 *    genere el borrador, y facturar por adelantado dejaría la factura fuera de su
 *    período y una cuenta por cobrar fantasma.
 */
export type EstadoCobro = 'PENDIENTE' | 'BORRADOR' | 'EMITIDO' | 'COBRADO' | 'PROYECTADO'

/** El dinero de un mes en UNA moneda. Nunca se suman monedas distintas. */
export interface TotalMes {
  moneda:    string
  /** Todo lo del mes: lo ya facturado más lo que queda por generar. */
  total:     number
  /** Lo que ya tiene factura viva (borradores incluidos). */
  facturado: number
  /** De lo facturado, lo que ya entró (facturado − saldo). */
  cobrado:   number
  /** Lo que todavía no tiene factura. */
  pendiente: number
}

export interface MesCalendario {
  periodo:  string            // 'YYYY-MM'
  /** En qué momento está el mes (ver `EstadoCobro`). */
  estado:   EstadoCobro
  /** Lo que se cobraría (pendiente o proyectado); vacío si el mes está cerrado. */
  grupos:   FacturacionGrupo[]
  /** Lo ya facturado de ese mes. */
  facturas: FacturaDelPeriodo[]
  /** Un total por moneda: sumar CUP con USD no significa nada. */
  totales:  TotalMes[]
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
  return hoyEnTz()
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
 * Fracción del ciclo que se cobra cuando el acuerdo empieza a mitad: los días que van de
 * `inicio` al final de su ciclo, sobre los días del ciclo completo.
 *
 * Devuelve 1 si el acuerdo empieza justo al abrir el ciclo (nada que prorratear) y nunca
 * más de 1: prorratear no puede cobrar de más. Los días se cuentan en UTC sobre fechas
 * 'YYYY-MM-DD', como todo el módulo.
 */
export function fraccionProrrateo(
  inicio: string, cicloInicio: string, per: PeriodicidadSub,
): { fraccion: number; diasCobrados: number; diasCiclo: number } {
  const dias = (a: string, b: string) => {
    const [y1, m1, d1] = a.split('-').map(Number)
    const [y2, m2, d2] = b.split('-').map(Number)
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
  }
  const cicloFin  = sumarPeriodo(cicloInicio, per)
  const diasCiclo = dias(cicloInicio, cicloFin)
  if (diasCiclo <= 0) return { fraccion: 1, diasCobrados: 0, diasCiclo: 0 }
  const desde = inicio > cicloInicio ? inicio : cicloInicio
  const diasCobrados = Math.max(0, Math.min(diasCiclo, dias(desde, cicloFin)))
  return { fraccion: diasCobrados / diasCiclo, diasCobrados, diasCiclo }
}

/** Un día antes de una fecha 'YYYY-MM-DD'. */
export function diaAnterior(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().split('T')[0]
}

/**
 * Avanza `fecha` de ciclo en ciclo hasta el primero que llegue a `minimo`.
 *
 * **Toda la aritmética de saltar ciclos vive aquí**, y la usan reanudar (a mano y
 * desde el cron) y renovar. Con una copia por sitio, lo que el diálogo promete
 * («el próximo cobro pasa del 15 jul al 15 sep») y lo que se guarda acaban
 * discrepando — y aquí discrepar significa cobrarle a alguien un mes que no debe.
 *
 * Devuelve además cuántos ciclos se saltaron, que es lo que se le enseña al dueño
 * antes de confirmar. El tope de vueltas es un cortafuegos ante un dato corrupto
 * (una fecha imposible), no un límite de negocio.
 */
export function avanzarHasta(
  fecha: string, per: PeriodicidadSub, minimo: string, maxCiclos = 600,
): { fecha: string; ciclos: number } {
  const tope = Math.min(maxCiclos, 600)
  let f = fecha, ciclos = 0
  while (f < minimo && ciclos < tope) { f = sumarPeriodo(f, per); ciclos++ }
  return { fecha: f, ciclos }
}

/** Meses COMPLETOS entre dos fechas 'YYYY-MM-DD'. 10 jul → 9 ago son 0; → 10 ago, 1. */
export function mesesCompletos(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split('-').map(Number)
  const [y2, m2, d2] = hasta.split('-').map(Number)
  const meses = (y2 - y1) * 12 + (m2 - m1)
  return Math.max(0, d2 >= d1 ? meses : meses - 1)
}

// ── Reanudar: la pausa no se cobra ────────────────────────────────────────────
//
// Pausar solo cambiaba `estado`, así que `fecha_proximo_cobro` se quedaba quieta y al
// reanudar el calendario presentaba **un cobro «Atrasado» por cada mes pausado**, que el
// cron facturaba uno por día. «PAUSADA no es adorno: un socio que se va dos meses no es
// una baja» — y el modelo se los cobraba igual.
//
// El PLAN es puro y vive aquí porque lo miran tres sitios: el diálogo de confirmación
// (que enseña las dos fechas antes de tocar nada), la acción del portal y el escáner del
// cron. La ESCRITURA vive en `suscripciones-core.ts`, que es donde está la base de datos.

/** Lo mínimo para calcular una reanudación. */
export interface AcuerdoPausado {
  suscripcion_id:      string
  periodicidad:        PeriodicidadSub
  fecha_proximo_cobro: string
  pausada_desde:       string | null
}

export interface PlanReanudacion {
  /** Fecha de cobro que queda tras aplicar la regla. */
  proximoCobro: string
  /** Cuántos ciclos cayeron dentro de la pausa (0 = no hay nada que saltar). */
  ciclos:       number
}

/**
 * Qué pasa con el calendario al reanudar, SIN escribir nada. Lo consume el diálogo de
 * confirmación (que enseña las dos fechas antes de tocar nada) y la propia escritura.
 *
 * Tres reglas, y las tres existen para no regalar dinero:
 *
 *  1. **Solo se saltan los cobros que caen DENTRO de la pausa** (`>= pausada_desde`), no
 *     «todo lo vencido hasta hoy». Un cobro que ya estaba atrasado ANTES de pausar es
 *     una deuda anterior: perdonarla al reanudar sería regalarla por pulsar un botón.
 *  2. **Nunca se perdona más tiempo del que la suscripción estuvo parada.** El tope es
 *     `meses de pausa ÷ meses del ciclo`, y es lo que salva a las periodicidades largas:
 *     una ANUAL pausada dos meses cuyo cobro caía en medio saltaría, sin este tope, el
 *     cobro del año entero — dos meses de pausa costando doce de ingreso.
 *  3. Sin `pausada_desde` (una pausa anterior a la mig. 161) no se salta nada: no hay
 *     dónde leer desde cuándo estaba parada, y cobrar de menos por una suposición es
 *     peor que dejarlo como estaba.
 *
 * Con el tope, una pausa que no llega a cubrir un ciclo completo deja el cobro donde
 * estaba: el ciclo se cobra entero. El prorrateo del ciclo a medias es otra cosa y tiene
 * su propia fase.
 */
export function planReanudacion(
  s: AcuerdoPausado, hoy: string, cobrarPausados = false,
): PlanReanudacion {
  if (cobrarPausados || !s.pausada_desde || s.fecha_proximo_cobro < s.pausada_desde) {
    return { proximoCobro: s.fecha_proximo_cobro, ciclos: 0 }
  }
  const maxCiclos = Math.floor(
    mesesCompletos(s.pausada_desde, hoy) / (MESES_PERIODO[s.periodicidad] ?? 1))
  if (maxCiclos <= 0) return { proximoCobro: s.fecha_proximo_cobro, ciclos: 0 }

  const { fecha, ciclos } = avanzarHasta(s.fecha_proximo_cobro, s.periodicidad, hoy, maxCiclos)
  return { proximoCobro: fecha, ciclos }
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

/**
 * ¿Este ciclo cae DENTRO de la vigencia del acuerdo?
 *
 * Un acuerdo con fin fijo y sin renovación no se cobra más allá de su `fecha_fin`, y eso
 * hay que mirarlo sobre el CICLO, no sobre el día de hoy. Es la diferencia entre las dos
 * preguntas: `estadoEfectivo` responde «¿está viva HOY?» y esto responde «¿se cobra ESTE
 * ciclo?». El calendario ya lo aplicaba en su bucle de proyección y la facturación del
 * período no, así que un acuerdo que termina el 14 seguía apareciendo como cobro
 * pendiente del día 15 — justo el caso que crea «Cancelar al final del período».
 */
export function cicloVigente(
  s: Pick<Suscripcion, 'fecha_fin' | 'renovacion_automatica'>, fecha: string,
): boolean {
  return !(s.fecha_fin && !s.renovacion_automatica && fecha > s.fecha_fin)
}

export function generarSuscripcionId(): string {
  return `SUS-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

export function generarLineaId(): string {
  return `SLN-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
