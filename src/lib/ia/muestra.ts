// ── Qué sale de CLAUX hacia el proveedor de IA ───────────────────────────────
// La regla del dueño (2026-09-06): «lo necesario, nunca el archivo entero».
//
// Vive aquí y no en cada consumidor a propósito. Escrita once veces, la regla se
// re-decide once veces: uno manda tres filas, otro manda «las primeras cien por si
// acaso» y nadie se entera hasta que hay que explicarlo. Todo lo que se manda al
// proveedor pasa por estas funciones.
//
// Lo que SÍ sale: nombres de columnas, de campos y de registros; hasta tres filas
// de muestra; importes y fechas cuando el juicio depende de ellos; el texto que el
// propio cliente nos escribió.
// Lo que NO: tablas enteras, y cualquier campo de la lista de prohibidos —que no
// son datos «sensibles» en abstracto, son los que no pintan nada en un juicio de
// estos y sí serían un problema fuera de casa.

/** Filas de muestra por llamada. Tres bastan para desempatar por contenido. */
export const TOPE_FILAS_MUESTRA = 3

/** Techo de caracteres de un bloque de contexto. Un prompt que se pasa se recorta. */
export const TOPE_CARACTERES = 6000

/**
 * Campos que nunca viajan, se pidan como se pidan. La comparación es por
 * FRAGMENTO del nombre en minúsculas: los archivos reales traen «Contraseña»,
 * «password_hash» o «Token del bot» y ninguno se llama igual dos veces.
 */
export const FRAGMENTOS_PROHIBIDOS = [
  'password', 'contrasena', 'contraseña', 'clave_acceso', 'token', 'api_key', 'apikey',
  'secret', 'secreto', 'carnet', 'identidad', 'ci_numero', 'pasaporte', 'tarjeta',
]

export function esCampoProhibido(nombre: string): boolean {
  const n = nombre.toLowerCase()
  return FRAGMENTOS_PROHIBIDOS.some(f => n.includes(f))
}

/** Recorta un texto al techo, avisando de que se recortó (importa para leer la respuesta). */
export function recortar(texto: string, max = TOPE_CARACTERES): string {
  const t = texto ?? ''
  return t.length <= max ? t : `${t.slice(0, max)}\n… (recortado)`
}

/**
 * Las filas de muestra de un archivo: como mucho `TOPE_FILAS_MUESTRA`, con las
 * columnas prohibidas vaciadas (no borradas: si desapareciera la columna, la fila
 * dejaría de cuadrar con las cabeceras y el emparejamiento saldría corrido).
 */
export function muestraFilas(filas: string[][], cabeceras: string[], n = TOPE_FILAS_MUESTRA): string[][] {
  const prohibidas = new Set(cabeceras.map((c, i) => (esCampoProhibido(c) ? i : -1)).filter(i => i >= 0))
  return filas.slice(0, n).map(f => f.map((v, i) => (prohibidas.has(i) ? '' : String(v ?? '').slice(0, 120))))
}

/** Una lista de nombres para el prompt, con techo y diciendo cuántos quedaron fuera. */
export function listaConTecho(items: string[], max: number): string[] {
  if (items.length <= max) return items
  return [...items.slice(0, max), `… y ${items.length - max} más (no caben en una llamada)`]
}
