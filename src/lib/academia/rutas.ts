/**
 * Dónde vive cada superficie del manual, y cómo se arma la URL de una pieza.
 *
 * Está en su propio archivo —y no en `piezas.ts`, que es donde nació— porque el
 * botón de ayuda de la cabecera del portal es un componente de cliente: si para
 * saber que la ayuda cuelga de `/ayuda` tuviera que importar `piezas`, se
 * llevaría al navegador la tabla entera del manual (el orden, los títulos y los
 * resúmenes de las 30 piezas) para usar una cadena de seis letras. `piezas.ts`
 * las reexporta, así que ningún otro archivo tuvo que cambiar.
 */

/** Las dos superficies del manual: la interna con sesión, y la pública sin ella. */
export const BASE_MANUAL = '/academia'
export const BASE_AYUDA  = '/ayuda'

/**
 * La URL de una pieza en la superficie que se esté pintando.
 *
 * El `base` va como parámetro y no como dos funciones porque el índice lateral,
 * la paginación «Anterior / Siguiente» y las tarjetas de la portada son los
 * mismos componentes en las dos: lo único que cambia entre `/academia/citas` y
 * `/ayuda/citas` es el prefijo.
 */
export function rutaDe(slug: string, base: string = BASE_MANUAL): string {
  return `${base}/${slug}`
}
