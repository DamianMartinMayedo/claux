import 'server-only'
import { cache } from 'react'
import { limitesDeNiveles, nombresDeNiveles } from '@/lib/niveles-server'
import type { Nivel } from '@/lib/niveles'

/**
 * Los topes de cada nivel, tal como están hoy en `nivel_limites`.
 *
 * Es el mismo criterio que los precios (`precios.ts`): el manual no teclea
 * cifras que el producto ya sabe. El dueño sube el tope de productos del nivel
 * Empresa en `/admin/niveles` y la ficha de Inventario lo dice al recargar, sin
 * que nadie tenga que acordarse de venir a cambiarlo aquí. Antes esto se
 * despachaba con «las cifras están en la comparativa de la web», que es mandar a
 * quien está vendiendo a buscar el dato en otra pantalla.
 *
 * Memorizado por petición con `cache()`: el manual entero son cincuenta piezas
 * de una tirada y varias llevan su tabla de topes; sin esto serían dos consultas
 * por pieza para pintar la misma matriz.
 *
 * Se lee `base` y no `base + extra_por_empresa`: el extra está sembrado a 0 en
 * todas partes y el tope es plano hoy (mig. 213). El día que deje de serlo, esta
 * tabla tendrá que decir de qué depende, y no basta con sumarlo en silencio.
 */

export type TopesAcademia = {
  /** `{ inicial: { productos: 200, … }, … }`. `null` = sin tope. */
  matriz: Record<string, Record<string, number | null>>
  /** Cómo se llama hoy cada nivel: la cabecera de la tabla no se escribe a mano. */
  nombresNivel: Record<Nivel, string>
}

export const topesDeNiveles = cache(async (): Promise<TopesAcademia> => {
  const [matriz, nombresNivel] = await Promise.all([limitesDeNiveles(), nombresDeNiveles()])
  return { matriz, nombresNivel }
})
