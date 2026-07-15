// ── Estado de resultados del dossier — lógica pura, sin I/O ─────────────────
//
// Deriva el estado de resultados (totales, márgenes, categorías, evolución) de
// la serie mensual + el desglose por categoría. La comparten la vista en pantalla
// y el PDF, así que vive aquí, pura y testeable. Los MÁRGENES son la parte nueva
// (la base contable no los calcula hoy).

import { TZ_NEGOCIO } from '@/lib/fecha-tz'
import type { FilaSerie } from './snapshot'
import type { LineaDesglose } from './base'

export interface CategoriaMonto { concepto: string; monto: number }

export interface FilaEvolucion {
  mes: string
  ingresos: number
  costoVentas: number
  gastosOperativos: number
  neto: number
}

export interface EstadoResultados {
  ingresos: number
  costoVentas: number
  margenBruto: number
  margenBrutoPct: number
  gastosOperativos: number
  resultadoNeto: number
  margenNetoPct: number
  ingresosPorCategoria: CategoriaMonto[]
  costoPorCategoria: CategoriaMonto[]
  gastosPorCategoria: CategoriaMonto[]
  evolucion: FilaEvolucion[]
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const pct = (parte: number, total: number) => (total > 0 ? round2((parte / total) * 100) : 0)

export function estadoDeResultados(serie: FilaSerie[], lineas: LineaDesglose[]): EstadoResultados {
  let ingresos = 0, costoVentas = 0, gastosOperativos = 0
  const evolucion: FilaEvolucion[] = [...serie]
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map(f => {
      ingresos += f.ingresos; costoVentas += f.costo_ventas; gastosOperativos += f.gastos_operativos
      return {
        mes: f.mes,
        ingresos: round2(f.ingresos), costoVentas: round2(f.costo_ventas),
        gastosOperativos: round2(f.gastos_operativos),
        neto: round2(f.ingresos - f.costo_ventas - f.gastos_operativos),
      }
    })

  ingresos = round2(ingresos); costoVentas = round2(costoVentas); gastosOperativos = round2(gastosOperativos)
  const margenBruto = round2(ingresos - costoVentas)
  const resultadoNeto = round2(ingresos - costoVentas - gastosOperativos)

  const deGrupo = (g: LineaDesglose['grupo']): CategoriaMonto[] =>
    lineas.filter(l => l.grupo === g)
      .sort((a, b) => a.orden - b.orden)
      .map(l => ({ concepto: l.concepto, monto: round2(l.monto) }))

  return {
    ingresos, costoVentas, margenBruto,
    margenBrutoPct: pct(margenBruto, ingresos),
    gastosOperativos, resultadoNeto,
    margenNetoPct: pct(resultadoNeto, ingresos),
    ingresosPorCategoria: deGrupo('INGRESO'),
    costoPorCategoria: deGrupo('COSTO_VENTAS'),
    gastosPorCategoria: deGrupo('GASTO_OPERATIVO'),
    evolucion,
  }
}

// ── Nota de conversión ─────────────────────────────────────────────────────────

/**
 * "Datos congelados a 15 jul 2026, 10:43" — la fecha del SNAPSHOT, no la de hoy.
 * Es la frase que sostiene la promesa del módulo: el PDF y el enlace público
 * dicen lo mismo porque leen el mismo congelado.
 */
export function congeladoA(iso: string | null): string {
  if (!iso) return 'Números sin congelar todavía'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Números sin congelar todavía'
  // Anclado a la zona del negocio, no a la del lector: el servidor está fuera de
  // Cuba, así que sin fijarla el SSR (UTC) y el navegador del dueño (Habana)
  // imprimirían horas distintas — mismatch de hidratación, y una hora que no es
  // la suya. Es la única hora de reloj que enseña el módulo; tiene que ser la de él.
  const fecha = new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ_NEGOCIO, day: '2-digit', month: 'short', year: 'numeric',
  }).format(d)
  const hora = new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ_NEGOCIO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d)
  return `Datos congelados a ${fecha}, ${hora}`
}

const nfTasa = new Intl.NumberFormat('es', { maximumFractionDigits: 4 })

function fechaCorta(f: string | null): string {
  if (!f) return ''
  const [y, m, d] = f.split('-')
  return `${d}/${m}/${y}`
}

/**
 * Texto de la nota de conversión, o null si no hay nada que declarar:
 *   "Tasas: 1 USD = 320 CUP (01/07/2026). No incluye importes en MLC."
 * `tasas` va indexado por moneda foránea; imprime "1 <presentación> = tasa <foránea>".
 */
export function notaConversion(
  monedaPresentacion: string,
  tasas: Record<string, { tasa: number; fecha: string | null }>,
  faltantes: string[],
): string | null {
  const partes = Object.entries(tasas).map(([codigo, d]) => {
    const fecha = d.fecha ? ` (${fechaCorta(d.fecha)})` : ''
    return `1 ${monedaPresentacion} = ${nfTasa.format(d.tasa)} ${codigo}${fecha}`
  })

  const trozos: string[] = []
  if (partes.length) trozos.push('Tasas: ' + partes.join(' · ') + '.')
  if (faltantes.length) trozos.push(`No incluye importes en ${faltantes.join(', ')}.`)

  return trozos.length ? trozos.join(' ') : null
}
