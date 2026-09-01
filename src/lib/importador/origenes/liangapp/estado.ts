// Lectura del Estado de rendimiento financiero de LiangApp.
//
// Es el cierre oficial del cliente: el modelo ONAT de 40 líneas, cada una con su
// rango de cuentas escrito en el propio concepto («Gastos Financieros (835 –
// 838)»). Con él, validar la migración deja de ser una comprobación inventada
// por nosotros y pasa a ser un cotejo contra su propia contabilidad.
//
// Medido contra AUGE 2025: las nueve cuentas exportadas cuadran al céntimo con
// sus líneas, y la utilidad antes del impuesto coincide con lo que reprodujo la
// migración. Por eso el dueño lo hizo obligatorio (plan, D2).

import type { ReporteLiangApp } from './detectar'
import { texto } from './detectar'
import { norm } from '../../util'

export interface FilaEstado {
  /** Número de línea del modelo (1..40). Es estable: el formato es oficial. */
  numero: number | null
  concepto: string
  importe: number
  /** Rango de cuentas de la línea, si el concepto lo trae escrito. */
  desde: number | null
  hasta: number | null
}

export interface EstadoLeido {
  empresa: string
  periodo: string
  filas: FilaEstado[]
  /** La última línea del modelo: el resultado del ejercicio antes de impuestos. */
  utilidadAntesDeImpuesto: number | null
  avisos: string[]
}

/**
 * El rango de cuentas del concepto. Se coge el ÚLTIMO paréntesis porque algunos
 * conceptos llevan uno de texto antes («… (importadores y otras entidades) (928
 * – 929)»), y LiangApp mezcla el guion normal con el largo.
 */
function rango(concepto: string): { desde: number | null; hasta: number | null } {
  let m: RegExpExecArray | null = null
  const re = /\((\d{3})\s*(?:[-–—]\s*(\d{3}))?\)/g
  for (let x = re.exec(concepto); x; x = re.exec(concepto)) m = x
  if (!m) return { desde: null, hasta: null }
  return { desde: +m[1], hasta: m[2] ? +m[2] : +m[1] }
}

function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = texto(v).replace(/\./g, '').replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function leerEstado(rep: Extract<ReporteLiangApp, { tipo: 'estado' }>): EstadoLeido {
  const data = rep.hoja.data ?? []
  const cab: Record<string, number> = {}
  ;(data[rep.iCabecera] ?? []).forEach((c, i) => { const k = norm(texto(c)); if (k && !(k in cab)) cab[k] = i })

  const filas: FilaEstado[] = []
  let utilidad: number | null = null

  for (let i = rep.iCabecera + 1; i < data.length; i++) {
    const f = data[i] ?? []
    const concepto = texto(f[cab['concepto']])
    const importe  = numero(f[cab['importe']])
    // La cola del modelo son las líneas de firma («HECHO POR: …»): sin importe.
    if (!concepto || importe === null) continue

    const numeroFila = numero(f[cab['fila']])
    filas.push({ numero: numeroFila, concepto, importe, ...rango(concepto) })
    // Por el texto y no por el número de línea: el rótulo es lo que no cambia.
    if (norm(concepto).includes('antes del impuesto')) utilidad = importe
  }

  const avisos: string[] = []
  if (!filas.length) avisos.push('El estado de rendimiento no trae ninguna línea con importe.')
  if (utilidad === null) avisos.push('No se ha encontrado la línea de «Utilidad o Pérdida antes del Impuesto».')

  return { empresa: rep.empresa, periodo: rep.periodo, filas, utilidadAntesDeImpuesto: utilidad, avisos }
}

/**
 * El importe oficial de una cuenta del mayor: la línea del modelo cuyo rango la
 * contiene. `null` si el estado no la recoge — que para una cuenta de balance es
 * lo normal, no un error.
 *
 * Se queda con el rango MÁS ESTRECHO que la contenga. El modelo alterna líneas
 * amplias («950 – 952») con líneas de una sola cuenta («924»), y si algún día se
 * solaparan, la específica es la que manda.
 */
export function importeOficial(estado: EstadoLeido, cuenta: number): number | null {
  let mejor: FilaEstado | null = null
  for (const f of estado.filas) {
    if (f.desde === null || f.hasta === null) continue
    if (cuenta < f.desde || cuenta > f.hasta) continue
    if (!mejor || (f.hasta - f.desde) < (mejor.hasta! - mejor.desde!)) mejor = f
  }
  return mejor ? mejor.importe : null
}
