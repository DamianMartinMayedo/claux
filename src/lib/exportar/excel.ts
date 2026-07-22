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
  return { type: Number, value: value ?? null, ...estilo }
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
