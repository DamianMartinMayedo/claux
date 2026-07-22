// Lectura del archivo que sube el operador: CSV o Excel, misma salida.
//
// Todo lo de abajo trabaja con `Record<string, string>` por fila (clave =
// cabecera), así que aquí se decide UNA vez cómo se convierte cada formato y el
// resto del importador no se entera de la diferencia.
//
// Excel no es un lujo: quita de un plumazo los dos destrozos más comunes del CSV
// —los acentos rotos por la codificación y el «1.500» leído como 1,50—, porque
// las celdas ya vienen con su tipo (número, fecha, texto Unicode).

import Papa from 'papaparse'
import readXlsxFile from 'read-excel-file/node'

export type FormatoArchivo = 'csv' | 'xlsx'

export interface ArchivoLeido {
  cabeceras: string[]
  filas:     Record<string, string>[]
  /** Lo que el archivo trae mal pero no impide seguir; se enseña antes de mapear. */
  avisos:    string[]
}

/** Error con mensaje pensado para el operador (la acción lo devuelve tal cual). */
export class ArchivoIlegible extends Error {}

const MAX_FILAS = 20_000

/** Cabeceras: fuera las vacías, y las repetidas se numeran para poder elegirlas. */
function normalizarCabeceras(brutas: string[]): { cabeceras: string[]; indices: number[] } {
  const cabeceras: string[] = []
  const indices:   number[] = []
  const vistas = new Map<string, number>()
  brutas.forEach((raw, i) => {
    const nombre = (raw ?? '').toString().trim()
    if (!nombre) return   // la coma de más al final de la línea: columna sin nombre
    const veces = (vistas.get(nombre) ?? 0) + 1
    vistas.set(nombre, veces)
    cabeceras.push(veces === 1 ? nombre : `${nombre} (${veces})`)
    indices.push(i)
  })
  return { cabeceras, indices }
}

/** Lo que el parser encontró roto, en cristiano. */
function avisosDePapa(errores: Papa.ParseError[]): string[] {
  const avisos: string[] = []
  const comillas = errores.filter(e => e.code === 'MissingQuotes' || e.code === 'InvalidQuotes')
  if (comillas.length) {
    avisos.push(
      `Hay comillas sin cerrar (empieza en la fila ${(comillas[0].row ?? 0) + 1}). ` +
      'Todo lo que va detrás se lee como una sola celda: revisa el archivo antes de seguir.',
    )
  }
  return avisos
}

function leerCsv(texto: string): ArchivoLeido {
  const parsed = Papa.parse<string[]>(texto, { skipEmptyLines: true })
  const bruto  = (parsed.data ?? []) as string[][]
  if (!bruto.length) throw new ArchivoIlegible('No se detectaron cabeceras en el archivo.')

  const { cabeceras, indices } = normalizarCabeceras(bruto[0])
  if (!cabeceras.length) throw new ArchivoIlegible('La primera fila del archivo no tiene nombres de columna.')

  const cuerpo = bruto.slice(1)
  const avisos = avisosDePapa(parsed.errors ?? [])
  // Celdas más allá de la última cabecera: son datos que nadie podrá mapear, y
  // casi siempre significan una coma dentro de un texto sin entrecomillar. Solo
  // se avisa si lo que sobra lleva algo escrito (la coma final suelta no cuenta).
  const anchas = cuerpo.filter(f => f.slice(bruto[0].length).some(v => (v ?? '').trim() !== '')).length
  if (anchas) {
    avisos.push(`${anchas} fila(s) traen más columnas que la cabecera y lo que sobra se ignora. Suele ser una coma dentro de un texto sin comillas.`)
  }

  const filas = cuerpo
    .map(f => Object.fromEntries(indices.map((src, j) => [cabeceras[j], (f[src] ?? '').toString().trim()])))
    .filter(f => Object.values(f).some(v => v !== ''))

  return { cabeceras, filas, avisos }
}

/** Celda de Excel → texto. Las fechas y los números ya vienen tipados: se respetan. */
function celdaATexto(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date)         return v.toISOString().slice(0, 10)   // aaaa-mm-dd, sin zona
  if (typeof v === 'boolean')    return v ? 'Sí' : 'No'
  if (typeof v === 'number')     return String(v)
  return v.toString().trim()
}

type HojaExcel = { sheet: string; data: unknown[][] }

async function leerXlsx(base64: string): Promise<ArchivoLeido> {
  let hojas: HojaExcel[]
  try {
    const salida = await readXlsxFile(Buffer.from(base64, 'base64')) as unknown
    const lista  = (salida ?? []) as unknown[]
    // Según el libro, la librería devuelve las filas o una lista de hojas.
    hojas = lista.length && !Array.isArray(lista[0])
      ? lista as HojaExcel[]
      : [{ sheet: '', data: lista as unknown[][] }]
  } catch (e) {
    throw new ArchivoIlegible(`No se pudo leer el Excel: ${(e as Error).message}`)
  }

  const conDatos = hojas.filter(h => (h.data ?? []).length > 1)
  const hoja = conDatos[0] ?? hojas[0]
  if (!hoja || !(hoja.data ?? []).length) throw new ArchivoIlegible('El Excel no tiene ninguna hoja con datos.')

  const avisos: string[] = []
  if (conDatos.length > 1) {
    avisos.push(`El archivo tiene ${conDatos.length} hojas con datos; se ha leído «${hoja.sheet}». Si querías otra, guárdala como archivo aparte.`)
  }

  const { cabeceras, indices } = normalizarCabeceras((hoja.data[0] ?? []).map(celdaATexto))
  if (!cabeceras.length) throw new ArchivoIlegible('La primera fila de la hoja no tiene nombres de columna.')

  const filas = hoja.data.slice(1)
    .map(f => Object.fromEntries(indices.map((src, j) => [cabeceras[j], celdaATexto(f?.[src])])))
    .filter(f => Object.values(f).some(v => v !== ''))

  return { cabeceras, filas, avisos }
}

/**
 * `contenido` es el texto del CSV o el Excel en base64 (así viaja binario por la
 * server action). Lanza `ArchivoIlegible` con un mensaje que se le puede enseñar
 * al operador tal cual.
 */
export async function leerArchivo(contenido: string, formato: FormatoArchivo): Promise<ArchivoLeido> {
  const limpio = contenido.replace(/^﻿/, '')
  if (!limpio.trim()) throw new ArchivoIlegible('El archivo está vacío.')

  if (formato === 'csv') {
    // Un binario renombrado a .csv entra aquí como texto ilegible; decirlo por su
    // nombre ahorra la media hora de mirar un mapeo en blanco sin entender nada.
    if (limpio.startsWith('PK\u0003\u0004')) throw new ArchivoIlegible('Esto es un Excel (.xlsx). Súbelo tal cual: ya se aceptan.')
    if (limpio.startsWith('%PDF'))           throw new ArchivoIlegible('Esto es un PDF, no una tabla de datos.')
    if (limpio.trimStart().startsWith('<'))  throw new ArchivoIlegible('Esto parece una página web o un XML, no un CSV.')
  }

  const leido = formato === 'xlsx' ? await leerXlsx(contenido) : leerCsv(limpio)
  if (!leido.filas.length) throw new ArchivoIlegible('El archivo no tiene filas de datos.')
  if (leido.filas.length > MAX_FILAS) {
    throw new ArchivoIlegible(`El archivo trae ${leido.filas.length} filas; el máximo por importación es ${MAX_FILAS}. Pártelo en varios.`)
  }

  // Muchas celdas ilegibles = casi siempre la codificación equivocada (un Excel
  // en español guardado como CSV se lee en Windows-1252, no en UTF-8).
  if (formato === 'csv') {
    const rotos = leido.cabeceras.join('').match(/�/g)?.length ?? 0
    if (rotos) leido.avisos.push('Hay caracteres ilegibles en las cabeceras: prueba a subirlo con la otra codificación, o súbelo en Excel.')
  }
  return leido
}
