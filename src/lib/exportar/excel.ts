// Generador de Excel (.xlsx) del lado servidor, REUTILIZABLE en toda la plataforma:
// plantillas del importador y exportaciones (reportes, clientes, pagos…). Envuelve
// `write-excel-file` para que quien exporta no dependa de su API ni del formato
// binario: pasa filas de celdas y recibe el Excel en base64, listo para descargar
// como Blob desde el cliente (descarga directa, sin abrir página — contexto Cuba).
//
// No es 'use server': es una utilidad que llaman las server actions.

import writeXlsxFile from 'write-excel-file/node'
import type { Cell, Row } from 'write-excel-file'

export const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Paleta de marca del documento. Hex fijo a propósito: un .xlsx no usa tokens CSS
// ni tiene modo oscuro. Cuadran con `--color-primary-active` y las superficies de
// `src/app/styles/01-tokens.css` (teal de banda con blanco encima).
export const MARCA = {
  teal:      '#007571',   // --color-primary-active (banda estable, blanco encima)
  tealTexto: '#00716D',   // --color-primary-text
  blanco:    '#FFFFFF',
  ejemploBg: '#EFEDE8',   // --color-surface-2
  ejemploTx: '#6B675E',   // gris cálido, tinta atenuada
  borde:     '#D5D2CA',
} as const

export type CeldaEstilo = Omit<NonNullable<Cell>, 'value' | 'type'>

/** Celda de texto (el 99 % de una plantilla/exportación) con estilo opcional. */
export function texto(value: string | null | undefined, estilo: CeldaEstilo = {}): Cell {
  return { type: String, value: value ?? '', ...estilo }
}

/** Celda numérica, con formato opcional (ej. '#,##0.00'). */
export function numero(value: number | null | undefined, estilo: CeldaEstilo = {}): Cell {
  // La celda vacía es `undefined` (la librería no admite `null` como valor).
  return { type: Number, value: value ?? undefined, ...estilo }
}

const ISO_FECHA = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/

/** ¿Es un `YYYY-MM-DD` (con o sin hora detrás)? */
export function esFechaIso(v: unknown): v is string {
  return typeof v === 'string' && ISO_FECHA.test(v)
}

/**
 * Celda de FECHA de verdad (no texto) a partir de un `YYYY-MM-DD`.
 *
 * Que en el .xlsx la fecha sea una fecha no es cosmética: en texto no se ordena
 * cronológicamente, no se filtra «este mes» y no entra en una tabla dinámica — que es
 * justo para lo que alguien se baja el Excel.
 *
 * **En UTC a propósito.** La librería convierte con `getTime()/864e5 + 25569`, sin
 * tocar la zona horaria: si se construyera con `new Date(2026, 6, 29)` en un servidor
 * en UTC-… la celda saldría con el día anterior. `Date.UTC` de una fecha SIN hora es
 * exactamente el serial que Excel espera. Devuelve `null` si no es una fecha ISO, para
 * que quien llama caiga a texto en vez de escribir una celda inválida.
 */
export function fecha(v: unknown, estilo: CeldaEstilo = {}): Cell | null {
  if (typeof v !== 'string') return null
  const m = ISO_FECHA.exec(v)
  if (!m) return null
  return {
    type:   Date,
    value:  new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
    format: 'dd/mm/yyyy',
    ...estilo,
  }
}

export interface HojaExcel {
  nombre:   string
  filas:    Row[]
  /** Ancho por columna (en caracteres). */
  columnas?: { width?: number }[]
}

/**
 * Arma un libro de una o varias hojas y lo devuelve en base64. La primera fila
 * de cada hoja se congela (cabecera visible al hacer scroll). Base64 porque es lo
 * que viaja limpio por una server action y el cliente reconstruye como Blob.
 */
export async function construirXlsxBase64(hojas: HojaExcel[]): Promise<string> {
  const buffer = await writeXlsxFile(hojas.map(h => h.filas), {
    sheets:          hojas.map(h => h.nombre),
    columns:         hojas.map(h => h.columnas ?? []),
    stickyRowsCount: 1,
    fontFamily:      'Calibri',
    fontSize:        11,
    buffer:          true,
  })
  return (buffer as Buffer).toString('base64')
}

/** Ancho de columna cómodo a partir del contenido más largo (acotado). */
export function anchoPara(...textos: (string | undefined)[]): number {
  const max = Math.max(10, ...textos.map(t => (t ?? '').length + 2))
  return Math.min(max, 48)
}

/**
 * Anchos de una tabla mirando **los datos**, no solo la cabecera.
 *
 * Con el ancho sacado del título, la columna «Cliente» sale a 10 caracteres y los
 * nombres se ven cortados; peor con los importes, que Excel tapa con `######` cuando no
 * caben — un fichero que hay que ensanchar a mano antes de poder leerlo.
 *
 * Se mira una MUESTRA de filas, no todas: con 20.000 filas medir la columna entera es
 * recorrer la tabla otra vez para ganar un par de caracteres.
 */
export function anchosPorColumna(
  cabeceras: string[], filas: unknown[][], muestra = 300,
): { width: number }[] {
  const tope = Math.min(filas.length, muestra)
  return cabeceras.map((h, c) => {
    let max = h.length
    for (let i = 0; i < tope; i++) {
      const v = filas[i]?.[c]
      if (v == null) continue
      // Un número se pinta más largo que su `String()`: separador de miles y dos
      // decimales por el formato '#,##0.00'.
      const largo = typeof v === 'number' ? String(Math.trunc(v)).length + 6 : String(v).length
      if (largo > max) max = largo
    }
    return { width: Math.min(Math.max(max + 2, 10), 48) }
  })
}
