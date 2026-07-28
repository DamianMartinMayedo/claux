// ── Descarga directa en el navegador ────────────────────────────────────────
//
// Un clic → archivo, sin abrir otra pestaña ni recargar: en Cuba cada navegación
// cuesta datos y tiempo. Los binarios (Excel) viajan en base64 desde la server
// action —son binarios, no texto— y aquí se reconstruyen como Blob.
//
// Vive suelto, sin importar nada de `./excel`, a propósito: ese módulo arrastra
// el escritor de Excel (server-only) y no debe entrar en el bundle del cliente.

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
// Duplicado a propósito del de `./csv`, por la misma razón que el de Excel: ese
// módulo es el GENERADOR y no tiene por qué entrar en el bundle del cliente solo
// para leer una constante.
export const CSV_MIME = 'text/csv;charset=utf-8'

/** Descarga un binario recibido en base64. */
export function descargarBase64(nombre: string, base64: string, mime: string): void {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  descargarBlob(nombre, new Blob([bytes], { type: mime }))
}

/** Descarga un Blob ya construido (texto, imagen, PDF…). */
export function descargarBlob(nombre: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href = url; a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}
