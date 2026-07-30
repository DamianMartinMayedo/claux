// ── Leer en el NAVEGADOR el archivo que sube el dueño ──
//
// La contrapartida de `lib/importador/archivo.ts`, que es lo que hace el servidor con lo
// que llega aquí. Vive fuera de `importador/` porque ese módulo es server-only (usa
// `read-excel-file/node` y `Buffer`): importarlo desde un componente cliente revienta el
// build. Y vive en `src/lib/` y no dentro de una pantalla porque ya son dos las que
// suben archivos —el importador masivo y el conteo físico—, y el trozo delicado (el
// binario a base64 sin desbordar la pila) no se copia dos veces.

/** Los dos formatos que se aceptan en todo el portal. */
export type FormatoSubida = 'csv' | 'xlsx'

/** Error con mensaje para el dueño: la pantalla lo enseña en un toast tal cual. */
export class ArchivoNoSoportado extends Error {}

/**
 * Binario → base64, que es como viaja un Excel por una server action.
 *
 * A trozos de 32 KB **a propósito**: `String.fromCharCode(...bytes)` con el array entero
 * desborda la pila de argumentos en cuanto el archivo pasa de unos cientos de KB, y un
 * inventario de 5.000 líneas los pasa.
 */
export function aBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

/**
 * Lee el archivo elegido y devuelve lo que espera la server action.
 *
 * `encoding` solo aplica al CSV: un Excel guardado como CSV desde un Windows en español
 * sale en Windows-1252 y los acentos llegan rotos. El .xlsx no tiene ese problema (las
 * celdas ya vienen con su tipo y en Unicode), y por eso es el que se recomienda.
 */
export function leerParaSubir(
  file: File, encoding = 'UTF-8',
): Promise<{ contenido: string; formato: FormatoSubida }> {
  // El .xls de antes de 2007 es otro formato binario entero, no un .xlsx con otro
  // nombre: decirlo por su nombre ahorra la media hora de mirar un error sin entenderlo.
  if (/\.xls$/i.test(file.name)) {
    return Promise.reject(new ArchivoNoSoportado(
      'El .xls antiguo no se puede leer. Ábrelo en Excel y guárdalo como .xlsx o CSV.',
    ))
  }
  const esExcel = /\.xlsx$/i.test(file.name)

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new ArchivoNoSoportado('No se pudo leer el archivo.'))
    reader.onload  = () => resolve({
      contenido: esExcel
        ? aBase64(reader.result as ArrayBuffer)
        : (reader.result as string) ?? '',
      formato: esExcel ? 'xlsx' : 'csv',
    })
    if (esExcel) reader.readAsArrayBuffer(file)
    else         reader.readAsText(file, encoding)
  })
}
