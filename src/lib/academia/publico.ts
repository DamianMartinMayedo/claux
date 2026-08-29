import 'server-only'
import { cache } from 'react'
import { ORDEN } from './piezas'
import { leerDoc, cuerpoFicha } from './contenido'
import { filtrarPorCapa } from './filtro'
import { capaPorClave, type ClaveCapa } from './capas'
import { leerManual, type PiezaLeida } from './manual'

/**
 * La cara PÚBLICA del manual: el centro de ayuda de `claux.es/ayuda`.
 *
 * No es otro documento ni otro texto. Es el mismo manual leído en la capa
 * `cliente` —el modelo «una fuente, muchas salidas» llevado hasta el final: la
 * raíz la escribe el equipo y de ella salen el manual interno, el del vendedor y
 * esta web, sin que nadie mantenga tres copias.
 *
 * Lo que sí cambia es el HABLA, y por eso existe este archivo. Dentro, el manual
 * se organiza en partes numeradas; el cliente ve dos de las seis, así que «Parte
 * VI» le nombra un tomo de un libro que no tiene. Y algunos resúmenes prometen
 * material que su capa no deja pasar. Traducir eso aquí —en un sitio, sobre la
 * pieza ya leída— evita la alternativa mala: escribir un segundo manual «para
 * clientes» que envejecería solo.
 */

/** Con qué ojos se lee el manual en la web pública. No es elegible: es la ruta. */
export const CAPA_PUBLICA: ClaveCapa = 'cliente'

export const capaPublica = () => capaPorClave(CAPA_PUBLICA)

/**
 * El título del texto, sustituido por el público.
 *
 * El `# Título` de una parte va DENTRO del Markdown (las fichas no lo llevan: su
 * cabecera se pinta con los datos del catálogo), así que cambiar el rótulo de la
 * tarjeta y del índice no basta: al abrirla seguiría diciendo «Parte VI». Se
 * cambia la línea, no el archivo.
 */
function conTitulo(cuerpo: string, titulo: string): string {
  const lineas = cuerpo.split('\n')
  const i = lineas.findIndex(l => l.trim() !== '')
  if (i < 0 || !/^#\s+/.test(lineas[i])) return cuerpo
  lineas[i] = `# ${titulo}`
  return lineas.join('\n')
}

/** Una pieza ya leída, dicha como se dice en `/ayuda`. */
export function aPublica(p: PiezaLeida): PiezaLeida {
  if (!p.publico) return p
  return {
    ...p,
    titulo: p.publico.titulo,
    nombre: p.publico.titulo,
    resumen: p.publico.resumen,
    cuerpo: p.cuerpo ? conTitulo(p.cuerpo, p.publico.titulo) : p.cuerpo,
  }
}

/**
 * El manual que publica el centro de ayuda: la capa `cliente`, con el habla
 * pública y **sin las piezas vacías**.
 *
 * Dentro, una pieza sin texto se anuncia «en preparación» porque el equipo
 * necesita ver el esqueleto entero. Fuera no: una página pública que solo dice
 * que algún día dirá algo no ayuda a nadie y encima se indexa. Aquí, lo que no
 * está escrito no existe.
 */
export const leerAyuda = cache(async (): Promise<PiezaLeida[]> => {
  const todas = await leerManual(CAPA_PUBLICA)
  return todas.filter(p => p.cuerpo).map(aPublica)
})

/**
 * Los slugs que `/ayuda` publica de verdad, sin tocar la base de datos.
 *
 * Es para el sitemap, y por eso no usa `leerAyuda`: esa lee además nombres y
 * precios en vivo de `modulos_catalogo`, y el sitemap se genera en el BUILD,
 * donde la clave de servicio no está disponible (misma razón por la que las
 * páginas legales no se prerenderizan). Un sitemap con URLs que dan 404 hace más
 * daño que no tener sitemap, así que se calcula con lo único que sí está: los
 * .md del repositorio, filtrados por la misma capa que la página.
 */
export const piezasPublicas = cache(async (): Promise<string[]> => {
  const capa = capaPublica()
  const textos = await Promise.all(ORDEN.map(p => leerDoc(p.archivo)))
  return ORDEN.filter((p, i) => {
    const md = textos[i]
    if (!md) return false
    return !!filtrarPorCapa(p.ficha ? cuerpoFicha(md) : md, capa).texto
  }).map(p => p.slug)
})
