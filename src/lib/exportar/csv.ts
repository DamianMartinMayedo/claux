// Generador de CSV — fuente ÚNICA para toda la plataforma.
//
// No es 'use server' ni depende de nada del servidor: lo llaman las server
// actions, y podría llamarlo el cliente. Tampoco importa `./excel`, que arrastra
// el escritor de xlsx (server-only) y no debe entrar en el bundle del cliente.
//
// ── POR QUÉ ESTAS REGLAS Y NO LAS "OBVIAS" ────────────────────────────────────
// El destino real de estos ficheros es **Excel en español**, no un parser. Con
// las opciones por defecto de un CSV "de manual" (coma, sin BOM) el resultado es
// un fichero que se abre con todo en una sola columna y los acentos rotos. Ya
// pasó: `admin/clientes` exporta así hoy.
//
//  · **BOM UTF-8** al principio. Sin él Excel asume la codificación del sistema y
//    «Suministros» sale como «SuministrosÂ». Es un fallo que solo se ve al abrir.
//  · **Separador `;`**. En configuración regional española la coma es el
//    separador DECIMAL, así que un CSV separado por comas no se puede tabular.
//  · **Decimal con coma** por lo mismo: con punto, Excel trata los importes como
//    texto y la columna no suma — que es justo para lo que se exporta.
//  · **Fecha dd/mm/aaaa**, la que Excel reconoce como fecha en esa configuración.
//  · **CRLF**, que es lo que espera el formato (RFC 4180) y no molesta a nadie.
//  · **Se entrecomilla SOLO lo que lo necesita** —lo que lleva `;`, comillas, un
//    salto de línea o espacios en los bordes—, con las comillas internas
//    duplicadas. Entrecomillarlo todo es más fácil de escribir pero infla el
//    fichero un 20-30 % en pura puntuación, y esto se descarga en 3G. Además, un
//    número SIN comillas es lo que hace que Excel lo tipe como número en vez de
//    dejarlo como texto alineado a la izquierda.
export const CSV_MIME = 'text/csv;charset=utf-8'

export type ValorCelda = string | number | boolean | Date | null | undefined

/**
 * Neutraliza la INYECCIÓN DE FÓRMULAS.
 *
 * Excel ejecuta como fórmula cualquier celda que empiece por `=`, `+`, `-` o `@`.
 * Los textos de estos ficheros los escribe el cliente (nombres de categorías, de
 * terceros, notas), y los abre alguien del equipo CLAUX en su máquina: es
 * exactamente el camino de un ataque por CSV. Se antepone un apóstrofo, que Excel
 * consume al mostrar el texto pero impide que lo interprete.
 */
function neutralizarFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

function celda(v: ValorCelda): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ''
    return String(v).replace('.', ',')
  }
  if (v instanceof Date) {
    const d = String(v.getDate()).padStart(2, '0')
    const m = String(v.getMonth() + 1).padStart(2, '0')
    return `${d}/${m}/${v.getFullYear()}`
  }
  // Una fecha ISO de solo-fecha se reformatea sin construir un `Date`: hacerlo la
  // interpretaría como UTC y en La Habana restaría un día (mismo fallo que ya se
  // arregló en `fmtFechaEs`).
  const s = String(v)
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(s)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return neutralizarFormula(s)
}

// Necesita comillas si lleva el separador, comillas, un salto de línea, o espacios
// en los bordes (sin comillas se perderían al abrir).
const NECESITA_COMILLAS = /[;"\r\n]|^\s|\s$/

function escapar(v: ValorCelda): string {
  const s = celda(v)
  return NECESITA_COMILLAS.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Construye el CSV completo, BOM incluido. Listo para `new Blob([texto])`. */
export function construirCsv(cabeceras: string[], filas: ValorCelda[][]): string {
  const lineas = [
    cabeceras.map(escapar).join(';'),
    ...filas.map(f => f.map(escapar).join(';')),
  ]
  return '﻿' + lineas.join('\r\n')
}
