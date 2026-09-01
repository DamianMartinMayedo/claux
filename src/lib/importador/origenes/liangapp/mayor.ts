// Lectura de un libro mayor de LiangApp.
//
// Devuelve las líneas del período con la fecha ARREGLADA, sin el asiento de
// cierre y con el total que tiene que cuadrar contra el estado de rendimiento
// financiero (ver `estado.ts`). No decide categorías ni entidades: eso es de
// `rutas.ts` y `reglas.ts`.

import type { ReporteLiangApp } from './detectar'
import { texto } from './detectar'
import { norm } from '../../util'

const MS_DIA = 86_400_000

const dosDec = (n: number) => Math.round(n * 100) / 100
const ymd = (y: number, mes: number, dia: number) =>
  `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`

export interface FechaMayor {
  /** `aaaa-mm-dd` */
  fecha: string
  /** Se deshizo el cambiazo de LiangApp. */
  corregida: boolean
  /** La celda no encaja con el mecanismo conocido: hay que mirarla. */
  dudosa: boolean
}

/**
 * LA PIEZA DELICADA DE TODO ESTO. Una fecha mal no da error: da un informe
 * mensual mentiroso. Lee esto entero antes de tocarla.
 *
 * **El fallo, en origen.** LiangApp muestra las fechas en `d/m/aaaa`, pero su
 * exportador las vuelve a interpretar como `m/d/aaaa` al escribir el Excel. Un
 * 6 de enero (`06/01/2025`) sale al archivo como el 1 de junio.
 *
 * **Por qué pasa desapercibido.** Solo puede equivocarse cuando el día es ≤ 12;
 * con día 13 o más no existe ese mes, el exportador no consigue construir la
 * fecha y escribe la celda como TEXTO, ya correcta. De ahí la regla:
 *
 *   celda de tipo Fecha  → SIEMPRE está cambiada  → hay que deshacerlo
 *   celda de tipo texto  → SIEMPRE está bien      → se lee tal cual
 *
 * Es la misma regla vista desde los dos lados, y explica los porcentajes reales
 * de AUGE 2025: el mayor 839 tiene el 100 % de celdas Fecha (todos sus apuntes
 * cayeron en día ≤ 12) y el 805 el 0 % (los suyos son de fin de mes).
 *
 * **El segundo destrozo, este de la librería.** `read-excel-file` no devuelve el
 * serial a medianoche: lo deja a las 23:59:15.999 UTC del día ANTERIOR (medido:
 * el mismo resto exacto en las 393 celdas de los nueve mayores de AUGE). Leerlo
 * con `getDate()`/`getMonth()` lo arregla por accidente en España (UTC+2) y lo
 * destroza en Vercel, que corre en UTC. Por eso aquí se redondea al día más
 * cercano y se usan SOLO los getters UTC: así da lo mismo en las dos.
 *
 * **Comprobado dos veces, contra los archivos reales de AUGE 2025:**
 * 1. Fuente externa: las 42 fechas cruzables con los CSV sacados de la pantalla
 *    de LiangApp (no del export) — 36 exactas, 1 indistinguible (día = mes) y 5
 *    con desfase de días, propio de un asiento contable fechado aparte.
 * 2. Consistencia interna: el número de asiento (`NC…`) crece con el tiempo. En
 *    crudo hay 56 saltos hacia atrás repartidos por los nueve mayores; aplicando
 *    esto quedan **0**, y sale igual con `TZ=UTC` que con `TZ=Europe/Madrid`.
 */
export function fechaDeCelda(celda: unknown): FechaMayor | null {
  if (celda instanceof Date) {
    const u = new Date(Math.round(celda.getTime() / MS_DIA) * MS_DIA)
    const mes = u.getUTCDate()          // el día del serial es el MES real
    const dia = u.getUTCMonth() + 1     // y el mes del serial, el DÍA real
    // Un día > 12 no puede ser un mes: esa celda no la escribió el mecanismo que
    // conocemos. Se lee literal y se marca, que es mejor que inventar.
    if (mes > 12) return { fecha: ymd(u.getUTCFullYear(), dia, mes), corregida: false, dudosa: true }
    return { fecha: ymd(u.getUTCFullYear(), mes, dia), corregida: true, dudosa: false }
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto(celda))
  if (!m) return null
  return { fecha: ymd(+m[3], +m[2], +m[1]), corregida: false, dudosa: false }
}

/** Número de una celda ya tipada; el texto con coma decimal es el plan B. */
function numero(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const t = texto(v).replace(/\./g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}

export interface LineaMayor {
  /** Fila dentro de la hoja, 1-based: es lo que se le enseña al operador. */
  fila: number
  fecha: string
  fechaCorregida: boolean
  /** `NC00000004`: identidad estable del apunte, y el orden real del archivo. */
  referencia: string
  documento: string
  descripcion: string
  debe: number
  haber: number
  /** `|debe − haber|`: el importe que cuadra contra el estado de rendimiento. */
  importe: number
}

export interface MayorLeido {
  cuenta: number
  nombreCuenta: string
  empresa: string
  periodo: string
  desde: string | null
  hasta: string | null
  lineas: LineaMayor[]
  /** Σ importe de las líneas, sin el cierre. */
  total: number
  /** El asiento de cierre del ejercicio, excluido a propósito. */
  cierre: { lineas: number; importe: number }
  fechas: {
    corregidas: number
    dudosas: number
    fueraDePeriodo: number
    /** Unos pocos casos para enseñar en el paso de validar. */
    ejemplos: { fila: number; referencia: string; leida: string; corregida: string }[]
  }
  avisos: string[]
}

/** Índice de columna por nombre de cabecera, normalizado. */
function columnas(cab: unknown[]): Record<string, number> {
  const map: Record<string, number> = {}
  cab.forEach((c, i) => { const k = norm(texto(c)); if (k && !(k in map)) map[k] = i })
  return map
}

const esCierre = (documento: string, descripcion: string) =>
  norm(documento).startsWith('cierre cuentas nominales') ||
  norm(descripcion).startsWith('cierre cuentas nominales')

export function leerMayor(rep: Extract<ReporteLiangApp, { tipo: 'mayor' }>): MayorLeido {
  const data = rep.hoja.data ?? []
  const col  = columnas(data[rep.iCabecera] ?? [])
  const avisos: string[] = []

  // El período viene en el preámbulo (`01/01/2025 - 31/12/2025 (acumulado)`) y
  // sirve de red: una fecha que se salga de ahí después de corregirla es señal
  // de que este archivo no se comporta como los que hemos medido.
  const p = /(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(rep.periodo)
  const desde = p ? (fechaDeCelda(p[1])?.fecha ?? null) : null
  const hasta = p ? (fechaDeCelda(p[2])?.fecha ?? null) : null

  const lineas: LineaMayor[] = []
  let cierreLineas = 0, cierreImporte = 0
  let corregidas = 0, dudosas = 0, fueraDePeriodo = 0, sinFecha = 0
  const ejemplos: MayorLeido['fechas']['ejemplos'] = []

  for (let i = rep.iCabecera + 1; i < data.length; i++) {
    const f = data[i] ?? []
    const documento   = texto(f[col['documento primario']])
    const descripcion = texto(f[col['descripcion']])
    const debe  = numero(f[col['debe']])
    const haber = numero(f[col['haber']])

    if (esCierre(documento, descripcion)) { cierreLineas++; cierreImporte += Math.abs(debe - haber); continue }
    if (!debe && !haber && !documento && !descripcion) continue   // fila en blanco

    const celda = f[col['fecha']]
    const fecha = fechaDeCelda(celda)
    if (!fecha) { sinFecha++; continue }
    if (fecha.corregida) {
      corregidas++
      if (ejemplos.length < 5) {
        const cruda = celda instanceof Date ? celda.toISOString().slice(0, 10) : texto(celda)
        ejemplos.push({ fila: i + 1, referencia: texto(f[col['referencia']]), leida: cruda, corregida: fecha.fecha })
      }
    }
    if (fecha.dudosa) dudosas++
    if ((desde && fecha.fecha < desde) || (hasta && fecha.fecha > hasta)) fueraDePeriodo++

    lineas.push({
      fila: i + 1,
      fecha: fecha.fecha,
      fechaCorregida: fecha.corregida,
      referencia: texto(f[col['referencia']]),
      documento,
      descripcion,
      debe,
      haber,
      importe: dosDec(Math.abs(debe - haber)),
    })
  }

  if (!lineas.length) avisos.push('El libro mayor no trae ninguna línea de movimiento.')
  if (sinFecha)       avisos.push(`${sinFecha} línea(s) sin fecha legible: se han dejado fuera.`)
  if (dudosas)        avisos.push(`${dudosas} fecha(s) no encajan con el fallo conocido de LiangApp y se han leído tal cual. Compruébalas antes de aplicar.`)
  if (fueraDePeriodo) avisos.push(`${fueraDePeriodo} fecha(s) caen fuera del período del propio archivo (${rep.periodo}). Revísalas: puede que este export no sea como los que conocemos.`)

  return {
    cuenta: rep.cuenta,
    nombreCuenta: rep.nombreCuenta,
    empresa: rep.empresa,
    periodo: rep.periodo,
    desde,
    hasta,
    lineas,
    total: dosDec(lineas.reduce((s, l) => s + l.importe, 0)),
    cierre: { lineas: cierreLineas, importe: dosDec(cierreImporte) },
    fechas: { corregidas, dudosas, fueraDePeriodo, ejemplos },
    avisos,
  }
}
