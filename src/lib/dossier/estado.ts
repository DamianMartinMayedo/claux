// ── Estado de resultados del dossier — lógica pura, sin I/O ─────────────────
//
// Deriva el estado de resultados (totales, márgenes, categorías, evolución) de
// la serie mensual + el desglose por categoría. La comparten la vista en pantalla
// y el PDF, así que vive aquí, pura y testeable. Los MÁRGENES son la parte nueva
// (la base contable no los calcula hoy).

import { TZ_NEGOCIO } from '@/lib/fecha-tz'
import { pctSobre } from '@/lib/pl/estado'
import type { FilaSerie } from './snapshot'
import type { LineaDesglose } from './base'

/**
 * Modo de publicación del estado de resultados (mig. 136). Lo elige el dueño: no
 * se deriva del dato, porque un dossier CON desglose puede querer enseñarse
 * resumido de todas formas.
 */
export type ModoEstado = 'RESUMEN' | 'DESGLOSADO'

export const MODOS_ESTADO: ModoEstado[] = ['RESUMEN', 'DESGLOSADO']

export const LABEL_MODO_ESTADO: Record<ModoEstado, string> = {
  RESUMEN:    'Resumen',
  DESGLOSADO: 'Desglosado',
}

export const AYUDA_MODO_ESTADO: Record<ModoEstado, string> = {
  RESUMEN:    'Las cifras y los márgenes, sin el detalle por concepto.',
  DESGLOSADO: 'Además, en qué se va cada grupo, con su peso sobre los ingresos.',
}

/** Sufijo del título del PDF y del nombre del archivo: el documento dice qué es. */
export const SUFIJO_MODO_ESTADO: Record<ModoEstado, string> = {
  RESUMEN:    'Resumen',
  DESGLOSADO: 'Desglosado',
}

export function esModoEstado(v: unknown): v is ModoEstado {
  return v === 'RESUMEN' || v === 'DESGLOSADO'
}

/** Un concepto del desglose con su peso sobre los ingresos del período. */
export interface CategoriaMonto { concepto: string; conceptoEn: string | null; monto: number; pct: number }

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
  /** Peso del coste de ventas sobre los ingresos (% vertical). */
  costoVentasPct: number
  margenBruto: number
  margenBrutoPct: number
  gastosOperativos: number
  /** Peso de los gastos operativos sobre los ingresos (% vertical). */
  gastosOperativosPct: number
  // ── Waterfall detallado (solo DESGLOSADO) ──
  // Parten `gastosOperativos` por rol; sus totales salen del DESGLOSE, no de la
  // serie. Con base cuadran exacto; a mano, el descuadre lo avisa el paso «El
  // desglose» (no se maquilla aquí).
  personal: number
  personalPct: number
  operativos: number
  operativosPct: number
  /**
   * Depreciación (fase 4): la parte del gasto que NO salió de la caja. Va DENTRO
   * del resultado operativo —es gasto de operar— pero con renglón propio, que es
   * lo que permite leer el documento por caja además de por resultado.
   */
  depreciacion: number
  depreciacionPct: number
  otros: number
  otrosPct: number
  /** EBIT = neto + otros; null si no hay «Otros» (sin nada debajo, sería el neto). */
  resultadoOperativo: number | null
  resultadoOperativoPct: number | null
  resultadoNeto: number
  margenNetoPct: number
  ingresosPorCategoria: CategoriaMonto[]
  costoPorCategoria: CategoriaMonto[]
  personalPorCategoria: CategoriaMonto[]
  gastosPorCategoria: CategoriaMonto[]
  depreciacionPorCategoria: CategoriaMonto[]
  otrosPorCategoria: CategoriaMonto[]
  evolucion: FilaEvolucion[]
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
// El porcentaje sale del motor común (`@/lib/pl/estado`): tenerlo dos veces es
// como el informe del portal y el del dossier acaban redondeando distinto el mismo
// margen y el dueño ve 60,0% en una pantalla y 59,9% en la otra.
const pct = pctSobre

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

  // El % de cada concepto va SOBRE LOS INGRESOS, no sobre el total de su grupo:
  // «Alimentos = 22% de lo que entra» es la cifra que compara un inversor entre
  // negocios; «Alimentos = 58% del coste de ventas» solo se compara consigo misma.
  const deGrupo = (g: LineaDesglose['grupo']): CategoriaMonto[] =>
    lineas.filter(l => l.grupo === g)
      .sort((a, b) => a.orden - b.orden)
      .map(l => ({ concepto: l.concepto, conceptoEn: l.concepto_en ?? null, monto: round2(l.monto), pct: pct(round2(l.monto), ingresos) }))

  // Los gastos operativos, partidos por rol para el waterfall detallado. Cada total
  // sale de SUS líneas del desglose (con base suman `gastosOperativos` exacto).
  const personalPorCategoria     = deGrupo('PERSONAL')
  const gastosPorCategoria       = deGrupo('GASTO_OPERATIVO')
  const depreciacionPorCategoria = deGrupo('DEPRECIACION')
  const otrosPorCategoria        = deGrupo('OTRO')
  const sumCats = (cats: CategoriaMonto[]) => round2(cats.reduce((s, c) => s + c.monto, 0))
  const personal     = sumCats(personalPorCategoria)
  const depreciacion = sumCats(depreciacionPorCategoria)
  const otros        = sumCats(otrosPorCategoria)
  // El bucket operativo es el RESIDUAL sobre el total de la serie: así Personal +
  // Operativos + Depreciación + Otros = gastosOperativos SIEMPRE y el waterfall
  // cuadra con el neto autoritativo. Con base coincide con la suma de sus líneas; a
  // mano absorbe el descuadre.
  const operativos = round2(gastosOperativos - personal - depreciacion - otros)
  // EBIT: solo cuando hay «Otros» debajo que lo separen del neto (misma regla que
  // reportes.ts). = neto + otros, así siempre cuadra con el neto autoritativo.
  const resultadoOperativo = otros > 0.005 ? round2(resultadoNeto + otros) : null

  return {
    ingresos, costoVentas,
    costoVentasPct: pct(costoVentas, ingresos),
    margenBruto,
    margenBrutoPct: pct(margenBruto, ingresos),
    gastosOperativos,
    gastosOperativosPct: pct(gastosOperativos, ingresos),
    personal,     personalPct:     pct(personal, ingresos),
    operativos,   operativosPct:   pct(operativos, ingresos),
    depreciacion, depreciacionPct: pct(depreciacion, ingresos),
    otros,        otrosPct:        pct(otros, ingresos),
    resultadoOperativo,
    resultadoOperativoPct: resultadoOperativo == null ? null : pct(resultadoOperativo, ingresos),
    resultadoNeto,
    margenNetoPct: pct(resultadoNeto, ingresos),
    ingresosPorCategoria: deGrupo('INGRESO'),
    costoPorCategoria: deGrupo('COSTO_VENTAS'),
    personalPorCategoria,
    gastosPorCategoria,
    depreciacionPorCategoria,
    otrosPorCategoria,
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

/**
 * Nota honesta del coste de ventas cuando el negocio NO tiene módulo de inventario
 * y los números vienen de la base: sin control de existencias, ese renglón son las
 * COMPRAS del período, no el coste de lo vendido (la misma verdad que `etiqueta_coste`
 * en `pl/estado.ts`). El rótulo se mantiene «Coste de ventas» —lo que un inversor
 * espera leer—; la nota lo matiza sin maquillar. Solo aplica con base (el usuario
 * manual rotuló su columna, es su declaración).
 */
export const NOTA_COSTE_COMPRAS =
  'Sin módulo de inventario, el coste de ventas refleja los costes directos del período (compras y proveedores), no ajustado por variación de existencias.'

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
