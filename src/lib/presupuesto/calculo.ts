// ── Cálculo puro del presupuesto de instalación ──
//
// Determinista, sin efectos, isomórfico (cliente + servidor). El coste de la suscripción
// mensual NO se calcula aquí: sale de `modulos_catalogo` (en vivo).
//
// ── LOS PRECIOS ENTRAN POR PARÁMETRO, NO POR IMPORT ──────────────────────────
// Antes las tarifas eran constantes importadas. Ahora vienen de la BD (mig. 168) y se pasan
// como argumento a propósito: esta función corre en el navegador para la vista previa en vivo
// y en el servidor para el recálculo autoritativo al guardar. Si cada lado leyera los precios
// por su cuenta, un cambio de tarifa a media sesión haría que la pantalla y lo guardado
// dijeran cifras distintas del mismo presupuesto.
//
// ── EL VOLUMEN MUEVE EL PRECIO ───────────────────────────────────────────────
// Antes no lo movía: las horas dependían solo de qué módulos se marcaban, así que declarar 20
// productos o 5.000 costaba lo mismo y el volumen solo encendía una nota de «revisar». Ahora
// cada línea escala por tramos, y el recargo suelto en dólares ($15 por tramo excedido)
// desaparece: mezclar horas × tarifa con un recargo en dólares hacía el desglose imposible de
// explicarle al cliente. Ahora todo son horas, y una sola tarifa las convierte en dinero.

import {
  CLAVE_BASE, CLAVE_CAJA, etiquetaFase,
  type FormatoDatos, type LineaParametro, type NumeroFase, type ParametrosPresupuesto,
} from './config'

export interface InstalacionInput {
  modulos:   string[]                    // claves contratadas (incluye 'base' si aplica)
  volumenes: Record<string, number>
  formato:   FormatoDatos
  /** Horas de migración de histórico cargadas por el comercial. */
  historicoHorasManual?: number
  /** Tarifa pactada con ESTE cliente. Si falta, la base de configuración. */
  tarifaHoraOverride?: number
  /** Descuento comercial sobre el total, 0-100. */
  descuentoPct?: number
  /**
   * Fases que este cliente NO contrata (1-4). Vacío = las cuatro, que es el caso normal y
   * el comportamiento de siempre.
   *
   * Una fase excluida **desaparece del desglose**, no se pinta a cero: una línea de $0 en
   * el papel que ve el cliente invita a preguntar por qué está ahí. Y no suma horas, que es
   * el punto: hasta ahora la migración de datos se cobraba siempre que hubiera un módulo
   * contratado, aunque el negocio empezara de cero y no hubiera nada que migrar.
   */
  fasesExcluidas?: number[]
}

/** Una línea dentro de una fase, con su cuenta a la vista: «4 empresas · 1h + 3 × 0,5h». */
export interface LineaDesglose {
  etiqueta: string
  horas:    number
  detalle:  string
}

export interface DesgloseFase {
  fase:        string
  horas:       number
  subtotalUsd: number
  detalle?:    string
  lineas?:     LineaDesglose[]
}

export interface Revision {
  linea:  string
  motivo: string
}

export interface InstalacionResultado {
  desglose:            DesgloseFase[]
  revisiones:          Revision[]
  horasTotal:          number
  /** Antes del descuento. */
  costeInstalacionUsd: number
  descuentoUsd:        number
  /** Lo que se cobra de verdad. */
  totalFinalUsd:       number
  tarifaHora:          number
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Redondeo a 2 decimales: las horas por tramo pueden ser 0,25 y los flotantes arrastran cola. */
const r2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Horas de una línea para un volumen dado.
 *
 * Las horas base se cobran siempre que el módulo esté contratado —configurar la primera
 * empresa cuesta aunque sea una— y a partir del volumen incluido se suman tramos completos:
 * pasarse por uno ya cuesta el tramo entero, que es como se factura el trabajo de verdad.
 */
export function horasDeLinea(
  // Solo los cuatro números, no la línea entera: así el formulario de Configuración —que
  // edita esos cuatro y no tiene `modulo` ni `orden`— puede usar ESTA función para su vista
  // previa en vez de un cast que miente o, peor, una copia de la fórmula que se desviaría.
  l: Pick<LineaParametro, 'horas_base' | 'incluido' | 'tramo' | 'horas_por_tramo'>,
  volumen: number,
): { horas: number; tramos: number } {
  const v = num(volumen)
  const exceso = Math.max(0, v - l.incluido)
  const tramos = l.tramo > 0 ? Math.ceil(exceso / l.tramo) : 0
  return { horas: r2(l.horas_base + tramos * l.horas_por_tramo), tramos }
}

function detalleLinea(l: Pick<LineaParametro, 'horas_base' | 'horas_por_tramo'>, volumen: number, tramos: number): string {
  const base = `${l.horas_base}h base`
  if (tramos <= 0) return `${num(volumen)} · ${base}`
  return `${num(volumen)} · ${base} + ${tramos} × ${l.horas_por_tramo}h`
}

export function calcularInstalacion(
  input: InstalacionInput,
  params: ParametrosPresupuesto,
): InstalacionResultado {
  const tarifaHora = num(input.tarifaHoraOverride) || num(params.tarifaHora)
  const modulos = new Set(input.modulos)
  const vol = input.volumenes ?? {}
  const revisiones: Revision[] = []

  // Una fase fuera no se calcula: ni horas, ni líneas, ni avisos. El de «vienen en papel»
  // colgaba de la Fase 2, así que sin este filtro se seguiría pidiendo revisar una
  // migración que no se va a hacer.
  const fuera = new Set((input.fasesExcluidas ?? []).map(Number))
  const dentro = (fase: NumeroFase) => !fuera.has(fase)

  const activas = (fase: 1 | 2) => params.lineas
    .filter(l => l.fase === fase && (!l.modulo || modulos.has(l.modulo)))
    .sort((a, b) => a.orden - b.orden)

  function acumular(fase: 1 | 2): { horas: number; lineas: LineaDesglose[] } {
    let horas = 0
    const lineas: LineaDesglose[] = []
    for (const l of activas(fase)) {
      const v = num(vol[l.clave])
      const { horas: h, tramos } = horasDeLinea(l, v)
      horas += h
      lineas.push({ etiqueta: l.etiqueta, horas: h, detalle: detalleLinea(l, v, tramos) })
      // Lo único que el cálculo NO puede poner en precio es el estado en que llegan los
      // datos: la misma cantidad de fichas en papel o en una hoja bien montada no es el
      // mismo trabajo. El volumen ya se cobra; esto se avisa para que lo mire una persona.
      if (fase === 2 && v > 0 && input.formato === 'papel') {
        revisiones.push({
          linea: l.etiqueta,
          motivo: 'Los datos vienen en papel o dispersos: las horas estimadas pueden quedarse cortas. Confírmalo antes de cerrar.',
        })
      }
    }
    return { horas: r2(horas), lineas }
  }

  const VACIA = { horas: 0, lineas: [] as LineaDesglose[] }

  // ── Fase 1: alta y configuración base ──
  const f1 = dentro(1) ? acumular(1) : VACIA
  const horasFase1 = dentro(1) ? r2(params.horasAlta + f1.horas) : 0

  // ── Fase 2: migración de datos (solo módulos activos) ──
  const f2 = dentro(2) ? acumular(2) : VACIA

  // ── Fase 3: formación (base + por módulo; el punto de venta cuesta lo suyo) ──
  let horasFase3 = 0
  if (dentro(3)) {
    horasFase3 = params.horasFormacionBase
    for (const clave of modulos) {
      if (clave === CLAVE_BASE) continue
      horasFase3 += clave === CLAVE_CAJA ? params.horasFormacionCaja : params.horasFormacionModulo
    }
    horasFase3 = r2(horasFase3)
  }

  // ── Fase 4: validación y cierre ──
  const horasFase4 = dentro(4) ? params.horasCierre : 0

  const desglose: DesgloseFase[] = []
  if (dentro(1)) desglose.push({
    fase: etiquetaFase(1),
    horas: horasFase1,
    subtotalUsd: r2(horasFase1 * tarifaHora),
    detalle: `${params.horasAlta}h de alta + lo que sume la configuración.`,
    lineas: f1.lineas,
  })
  if (dentro(2)) desglose.push({
    fase: etiquetaFase(2),
    horas: f2.horas,
    subtotalUsd: r2(f2.horas * tarifaHora),
    lineas: f2.lineas,
  })
  if (dentro(3)) desglose.push({
    fase: etiquetaFase(3),
    horas: horasFase3,
    subtotalUsd: r2(horasFase3 * tarifaHora),
  })
  if (dentro(4)) desglose.push({
    fase: etiquetaFase(4),
    horas: horasFase4,
    subtotalUsd: r2(horasFase4 * tarifaHora),
  })

  let horasTotal = r2(horasFase1 + f2.horas + horasFase3 + horasFase4)

  // ── Migración de histórico: horas que valora el comercial, a la misma tarifa ──
  // Tenía tarifa propia ($40/h) y, sobre todo, sus horas NO entraban en `horasTotal`: la
  // tarjeta decía «19h» mientras sus propias filas sumaban 29h, y el `horas_total` que se
  // guarda —el que luego se compara con `horas_reales`— se dejaba fuera las horas más caras.
  const histHoras = num(input.historicoHorasManual)
  if (histHoras > 0) {
    desglose.push({
      fase: 'Migración de histórico (cotización manual)',
      horas: histHoras,
      subtotalUsd: r2(histHoras * tarifaHora),
      detalle: `${histHoras}h × $${tarifaHora}/h (valoración del comercial).`,
    })
    horasTotal = r2(horasTotal + histHoras)
  }

  const costeInstalacionUsd = r2(horasTotal * tarifaHora)
  const pct = Math.min(100, Math.max(0, num(input.descuentoPct)))
  const descuentoUsd = r2(costeInstalacionUsd * (pct / 100))

  return {
    desglose,
    revisiones,
    horasTotal,
    costeInstalacionUsd,
    descuentoUsd,
    totalFinalUsd: r2(costeInstalacionUsd - descuentoUsd),
    tarifaHora,
  }
}
