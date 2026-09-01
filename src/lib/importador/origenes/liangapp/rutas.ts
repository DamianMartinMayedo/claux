// De una cuenta del plan contable cubano (ONAT) a una entidad de CLAUX, y de una
// línea del mayor a una fila de nuestras plantillas.
//
// El enrutado es determinista y no le pregunta nada al operador: **la cuenta va
// escrita en el propio archivo** (fila 4 del mayor), así que no hay nada que
// adivinar. Lo que sí se le pregunta —la categoría de cada gasto— es otra cosa y
// vive en `reglas.ts`.
//
// La tabla de abajo nombra las cuentas que hemos visto. Lo que no esté nombrado
// NO se rechaza: cae en el tramo ONAT que le corresponde (800-899 gasto,
// 900-999 ingreso) y entra sin categoría propuesta, que es exactamente lo que
// hay que hacer con la cuenta de un cliente que todavía no hemos mirado.

import { nombresDe } from './reglas'
import type { LineaMayor } from './mayor'

export type EntidadDestino = 'gastos' | 'cobros'

export interface RutaCuenta {
  /** `null` = esta cuenta no se importa. */
  entidad: EntidadDestino | null
  /**
   * Clave del CATÁLOGO cuando la cuenta la decide sola; si no, `null` y clasifican
   * las reglas. Es una clave, nunca un nombre suelto: el perfil no inventa
   * categorías, mapea a `src/lib/catalogo/catalogo.ts` (§4 del plan).
   */
  catalogo: string | null
  /** Cómo se llama esto para el operador. */
  etiqueta: string
  /** Por qué no se importa (solo con `entidad: null`). */
  motivo?: string
  /**
   * Es la cuenta de VENTAS: sus líneas con `F…` son facturas y no se importan
   * como cobro, se listan para el importador de facturas (plan, D3).
   *
   * Va marcado cuenta a cuenta y no «todo cobro con F…» a propósito. Un número
   * de factura en la 924 (variación de tasa de cambio) es la revaluación de una
   * factura, no una venta: sacarla del lote dejaría esa cuenta sin cuadrar
   * contra el estado y sin nada que la compense.
   */
  facturable?: boolean
}

interface Tramo extends RutaCuenta { desde: number; hasta: number }

// Ordenado de más específico a más general: gana el primero que encaja.
const TRAMOS: Tramo[] = [
  { desde: 800, hasta: 804, entidad: null, catalogo: null, etiqueta: 'Devoluciones y Rebajas en Ventas',
    motivo: 'Es una contra-venta: resta de ventas, no es un gasto. Si el cliente tiene importe aquí, se mira aparte.' },
  { desde: 805, hasta: 809, entidad: 'gastos', catalogo: 'gas_imp_servicios', etiqueta: 'Impuesto por las Ventas' },
  { desde: 810, hasta: 818, entidad: 'gastos', catalogo: null, etiqueta: 'Costo de Ventas' },
  { desde: 819, hasta: 821, entidad: 'gastos', catalogo: null, etiqueta: 'Gastos de Distribución y Ventas' },
  { desde: 822, hasta: 824, entidad: 'gastos', catalogo: null, etiqueta: 'Gastos Generales y de Administración' },
  { desde: 826, hasta: 833, entidad: 'gastos', catalogo: null, etiqueta: 'Gastos de Operación' },
  { desde: 835, hasta: 838, entidad: 'gastos', catalogo: null, etiqueta: 'Gastos Financieros' },
  { desde: 839, hasta: 839, entidad: 'gastos', catalogo: 'gas_dif_cambio', etiqueta: 'Pérdidas en Tasas de Cambio' },
  { desde: 855, hasta: 864, entidad: 'gastos', catalogo: 'contribucion_ss_empresa',
    etiqueta: 'Otros Impuestos, Tasas y Contribuciones' },
  { desde: 900, hasta: 913, entidad: 'cobros', catalogo: null, etiqueta: 'Ventas', facturable: true },
  { desde: 920, hasta: 922, entidad: 'cobros', catalogo: null, etiqueta: 'Ingresos Financieros' },
  { desde: 924, hasta: 924, entidad: 'cobros', catalogo: null, etiqueta: 'Ingresos por Variación de Tasa de Cambio' },
  { desde: 950, hasta: 952, entidad: 'cobros', catalogo: null, etiqueta: 'Otros Ingresos' },
  { desde: 999, hasta: 999, entidad: null, catalogo: null, etiqueta: 'Resultado del ejercicio',
    motivo: 'Es el asiento de cierre, no un movimiento.' },
]

export function rutaDeCuenta(cuenta: number): RutaCuenta {
  const t = TRAMOS.find(x => cuenta >= x.desde && cuenta <= x.hasta)
  if (t) { const { desde: _d, hasta: _h, ...ruta } = t; return ruta }
  // Sin nombrar, pero dentro del resultado: entra igual. Un cliente puede llevar
  // cuentas que aquí no estén y no por eso se queda su gasto fuera.
  if (cuenta >= 800 && cuenta <= 899) return { entidad: 'gastos', catalogo: null, etiqueta: `Cuenta ${cuenta}` }
  if (cuenta >= 900 && cuenta <= 998) return { entidad: 'cobros', catalogo: null, etiqueta: `Cuenta ${cuenta}` }
  return {
    entidad: null, catalogo: null, etiqueta: `Cuenta ${cuenta}`,
    motivo: 'Es una cuenta de balance (no de resultado): ni gasto ni ingreso. El efectivo se lleva aparte, por Tesorería.',
  }
}

/**
 * El número de factura de una línea, si lo lleva. Está en DOS sitios y hay que
 * mirar en los dos: en `Documento primario` (`F2025000001`) y metido dentro del
 * texto libre (`TERMOMETRO FACT F2025000005`). Mirar solo uno pierde casos
 * reales, medido sobre el mayor 900 de AUGE.
 */
export function numeroFactura(l: Pick<LineaMayor, 'documento' | 'descripcion'>): string | null {
  const re = /\bF\d{6,}\b/
  return (re.exec(l.documento)?.[0] ?? re.exec(l.descripcion)?.[0] ?? null)
}

/**
 * Importe como texto para nuestro lector de celdas. Siempre con DOS decimales a
 * propósito: `parseNumero` toma por separador de miles un punto seguido de tres
 * dígitos, así que un «1.500» que quisiera decir 1,5 se leería 1500. Con
 * `toFixed(2)` eso no puede pasar nunca.
 */
const importeTexto = (n: number) => n.toFixed(2)

/** La huella de dónde salió cada fila. Sin esto, una migración no se puede auditar. */
function trazaLiangApp(cuenta: number, l: LineaMayor): string {
  const doc = l.documento && l.documento !== l.descripcion ? ` · ${l.documento}` : ''
  return `LiangApp ${cuenta}/${l.referencia}${doc}`
}

/**
 * Columnas de servicio que viajan con la fila y NO son del mapeo: el motor solo
 * lee las columnas que el mapeo nombra (`construirValores`), así que estas dos
 * le pasan por delante sin que se entere. Sirven para poder reclasificar o
 * apartar una cuenta entera después, sin volver a subir los archivos —que es lo
 * que costaría en una conexión cubana.
 */
export const COL_CUENTA = '_cuenta'
export const COL_GRUPO  = '_grupo'
/** Posición original dentro del lote: apartar una cuenta y volver a meterla no
 *  puede cambiar el orden de las filas, o los números de fila que vio el
 *  operador en el paso de revisar dejarían de señalar a lo mismo. */
export const COL_ORDEN  = '_n'

/**
 * Una línea del mayor → una fila de la plantilla de CLAUX, con las CABECERAS
 * iguales que los campos internos del adaptador (el mapeo va 1:1, ver
 * `mapeoColumnas`).
 *
 * Lo que no se rellena aquí y por qué:
 *  · `moneda` — el mayor no la dice. Va vacía para que mande el valor por defecto
 *    del lote, que sale de las monedas del cliente. Poner «CUP» a mano sería
 *    inventarse una moneda que ese cliente puede no tener.
 *  · `categoria` — vacía mientras nadie haya propuesto una clave del catálogo.
 *    La proponen las reglas y la confirma el operador (§6 del plan).
 */
export function filaCanonica(
  cuenta: number, ruta: RutaCuenta, l: LineaMayor, grupo: string, clave: string | null,
): Record<string, string> {
  const traza = trazaLiangApp(cuenta, l)
  const comun = {
    fecha:  l.fecha,
    monto:  importeTexto(l.importe),
    moneda: '',
    // Histórico: se da por saldado contra la cuenta técnica «Apertura», fechado
    // en el período del movimiento y nunca hoy (lo hace el adaptador).
    pagado: 'Sí',
    [COL_CUENTA]: String(cuenta),
    [COL_GRUPO]:  grupo,
  }
  if (ruta.entidad === 'cobros') {
    // Un COBRO lleva concepto libre, no categoría (mig. 126): la descripción del
    // mayor entra tal cual y no hay que clasificar la 900.
    return { ...comun, concepto: l.descripcion || l.documento || ruta.etiqueta, notas: traza }
  }
  return {
    ...comun,
    ...categoriaDeClave(clave),
    notas: l.descripcion ? `${l.descripcion} · ${traza}` : traza,
  }
}

/** Las dos columnas de categoría de una clave del catálogo (o vacías si no hay). */
export function categoriaDeClave(clave: string | null): { categoria: string; subcategoria: string } {
  const n = clave ? nombresDe(clave) : null
  return n ?? { categoria: '', subcategoria: '' }
}

/** Las columnas que escribe el perfil, en el orden en que se leen. */
export function camposDe(entidad: EntidadDestino): string[] {
  return entidad === 'cobros'
    ? ['fecha', 'concepto',  'monto', 'moneda', 'pagado', 'notas']
    : ['fecha', 'categoria', 'subcategoria', 'monto', 'moneda', 'pagado', 'notas']
}

/**
 * El mapeo del lote: como las cabeceras las escribimos nosotros con el nombre
 * interno del campo, va 1:1. El operador no mapea columnas en una migración de
 * LiangApp — ese paso lo sustituye el reconocimiento.
 */
export function mapeoColumnas(entidad: EntidadDestino): Record<string, string> {
  return Object.fromEntries(camposDe(entidad).map(c => [c, c]))
}
