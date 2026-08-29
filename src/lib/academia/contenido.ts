import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Lee el Markdown fuente de la Academia desde `content/academia/`.
 *
 * El texto es la fuente de verdad; se escribe a mano. Un archivo que aún no
 * existe devuelve `null`, y la página lo pinta como «en preparación» — así el
 * índice muestra la estructura completa desde el primer día y las fichas van
 * apareciendo según se escriben.
 */

const RAIZ = join(process.cwd(), 'content', 'academia')

/**
 * El índice lateral y el buscador se arman con TODOS los documentos, así que
 * cada página del manual leería el manual entero de disco. Como los .md se
 * despliegan con la función y no cambian hasta el siguiente despliegue, se
 * recuerdan en memoria: la primera visita paga el disco y las siguientes no.
 *
 * En desarrollo no se recuerda nada: ahí los archivos SÍ cambian mientras se
 * escriben, y un manual que no refresca al guardar es peor que uno lento.
 */
const memoria = new Map<string, string>()
const RECORDAR = process.env.NODE_ENV === 'production'

/**
 * Un archivo que falta se traga en silencio a propósito (se ve «en preparación»),
 * pero ese mismo silencio esconde el fallo de despliegue: estos .md se leen por
 * FS en runtime, así que si no están trazados en `outputFileTracingIncludes`
 * («/academia/**» en next.config.ts) no viajan a la función de Vercel y el manual
 * entero sale vacío — sin que se note en local, donde hay disco real. Por eso se
 * deja rastro en el log del servidor: ausente y roto no son lo mismo.
 */
export async function leerDoc(rel: string): Promise<string | null> {
  const guardado = memoria.get(rel)
  if (guardado !== undefined) return guardado

  try {
    const texto = await readFile(join(RAIZ, rel), 'utf8')
    if (RECORDAR) memoria.set(rel, texto)
    return texto
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException)?.code
    if (codigo === 'ENOENT') console.info(`[academia] sin escribir todavía: ${rel}`)
    else console.error(`[academia] no se pudo leer ${rel} (${codigo}):`, e)
    // Un fallo NO se recuerda: la ficha que se escriba después tiene que aparecer.
    return null
  }
}

/**
 * Quita de una ficha su `# Título` inicial y el blockquote de meta que le sigue
 * (el que NO empieza por «etiquetas:»): la cabecera de la ficha se pinta desde
 * los datos del catálogo, no desde el texto. Deja intacto el resto.
 */
export function cuerpoFicha(md: string): string {
  const lineas = md.split('\n')
  let i = 0
  // Saltar líneas en blanco iniciales.
  while (i < lineas.length && lineas[i].trim() === '') i++
  // Saltar el H1.
  if (i < lineas.length && /^#\s+/.test(lineas[i])) {
    i++
    while (i < lineas.length && lineas[i].trim() === '') i++
    // Saltar un blockquote de meta que no sea de etiquetas.
    if (i < lineas.length && lineas[i].startsWith('>') && !/^>\s*etiquetas:/i.test(lineas[i])) {
      while (i < lineas.length && lineas[i].startsWith('>')) i++
    }
  }
  return lineas.slice(i).join('\n').replace(/^\s+/, '')
}
