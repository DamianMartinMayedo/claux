// ¿Este archivo es de LiangApp? ¿Qué reporte? ¿De qué cuenta?
//
// LiangApp es la plataforma de contabilidad certificada que usan muchos clientes
// cubanos. No exporta a nuestras plantillas: exporta SUS reportes, con preámbulo,
// membrete y la cabecera real a media hoja. Este módulo es la puerta: mira el
// contenido y dice qué tiene delante, sin preguntarle nada al operador.
//
// Se detecta por CONTENIDO, nunca por el nombre del archivo: el cliente los
// renombra («mayor gastos def2.xlsx») y tiene que seguir funcionando.

import type { HojaExcel } from '../../archivo'
import { norm } from '../../util'

/** Texto de una celda, para comparar. Las celdas de estos reportes son texto. */
export function texto(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return ''          // una fecha nunca es un rótulo
  return String(v).trim()
}

/** Primera fila (de las `hasta` primeras) que cumple `test`; -1 si ninguna. */
function buscarFila(data: unknown[][], hasta: number, test: (f: unknown[]) => boolean): number {
  const tope = Math.min(hasta, data.length)
  for (let i = 0; i < tope; i++) if (data[i] && test(data[i])) return i
  return -1
}

/** El valor que va detrás de un rótulo del preámbulo: `Empresa:AUGE SRL` → `AUGE SRL`. */
function trasRotulo(data: unknown[][], rotulo: string): string {
  const r = norm(rotulo)
  for (let i = 0; i < Math.min(8, data.length); i++) {
    const c = norm(texto(data[i]?.[0]))
    if (c.startsWith(r)) return texto(data[i][0]).slice(texto(data[i][0]).indexOf(':') + 1).trim()
  }
  return ''
}

export interface ComunLiangApp {
  /** Nombre de la empresa según el propio reporte (fila `Empresa:…`). */
  empresa: string
  /** Período tal cual lo escribe LiangApp: `01/01/2025 - 31/12/2025 (acumulado)`. */
  periodo: string
  hoja: HojaExcel
  /** Índice (0-based) de la fila de cabecera real dentro de la hoja. */
  iCabecera: number
}

export type ReporteLiangApp =
  | (ComunLiangApp & { tipo: 'mayor'; cuenta: number; nombreCuenta: string })
  | (ComunLiangApp & { tipo: 'estado' })

/** Las columnas de la cabecera del libro mayor, en el orden en que las escribe. */
const CAB_MAYOR  = ['fecha', 'referencia', 'documento primario', 'descripcion', 'debe', 'haber', 'saldo']
const CAB_ESTADO = ['concepto', 'fila', 'importe']

const filaEs = (f: unknown[], cab: string[]) => {
  const celdas = f.map(c => norm(texto(c)))
  return cab.every(c => celdas.includes(c))
}

/**
 * Reconoce una hoja. Devuelve `null` si no es de LiangApp — que es la respuesta
 * correcta para cualquier otro archivo, incluidas nuestras propias plantillas.
 *
 * No se fija en un número de fila concreto: busca la cabecera en las primeras
 * quince. Si mañana LiangApp añade una línea de membrete, esto sigue leyendo.
 */
export function detectarHoja(hoja: HojaExcel): ReporteLiangApp | null {
  const data = hoja.data ?? []
  if (data.length < 3) return null

  const comun = (iCabecera: number): ComunLiangApp => ({
    empresa: trasRotulo(data, 'empresa'),
    // LiangApp lo escribe con tilde; se acepta sin ella por si cambia.
    periodo: trasRotulo(data, 'periodo'),
    hoja,
    iCabecera,
  })

  const iEstado = buscarFila(data, 15, f => filaEs(f, CAB_ESTADO))
  if (iEstado >= 0) return { tipo: 'estado', ...comun(iEstado) }

  const iMayor = buscarFila(data, 15, f => filaEs(f, CAB_MAYOR))
  if (iMayor < 0) return null

  // La cuenta va en la última fila ANTES de la cabecera que empieza por un
  // número: `822 | · | Gastos Generales y de Administración`. Está escrita en el
  // archivo, así que no hay que adivinarla ni pedírsela al operador.
  for (let i = iMayor - 1; i >= 0; i--) {
    const n = data[i]?.[0]
    if (typeof n !== 'number' || !Number.isInteger(n)) continue
    const nombreCuenta = texto(data[i].slice(1).find(c => texto(c) !== ''))
    return { tipo: 'mayor', cuenta: n, nombreCuenta, ...comun(iMayor) }
  }
  return null
}

/**
 * El archivo entero. Se queda con la PRIMERA hoja reconocible: estos reportes
 * traen una sola, y si algún día trajeran más, la de datos es la primera.
 */
export function detectarArchivo(hojas: HojaExcel[]): ReporteLiangApp | null {
  for (const h of hojas) {
    const r = detectarHoja(h)
    if (r) return r
  }
  return null
}
