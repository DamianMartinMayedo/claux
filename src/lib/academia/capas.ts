/**
 * Las tres capas de acceso, que son la razón de ser del modelo «una fuente,
 * muchas salidas»: el manual interno es la raíz y lo que ve quien vende o un
 * cliente es una PROYECCIÓN FILTRADA de él, no otro documento.
 *
 * El filtro es la línea `> etiquetas: <audiencia> · <profundidad>` que lleva cada
 * apartado. Una capa es, literalmente, el conjunto de audiencias que deja pasar.
 *
 * Para el SUPER ADMIN esto es una PREVISUALIZACIÓN: el selector «Ver como» sirve
 * para comprobar con qué se va a encontrar un vendedor antes de darle la cuenta,
 * y por eso puede moverse libremente entre las tres.
 *
 * Para un VENDEDOR es un candado. Su capa no sale de la cookie sino de su rol
 * (`capaDeRol`), así que ni el selector ni una cookie puesta a mano le devuelven
 * lo que su capa no deja pasar. Es la misma diferencia de siempre: mirar cómo se
 * ve algo no es tener permiso para verlo.
 */

import type { RolAdmin } from '@/lib/roles'

export type Audiencia = 'usar' | 'vender' | 'operar' | 'confidencial'

export type ClaveCapa = 'interna' | 'vendedor' | 'cliente'

export type Capa = {
  clave: ClaveCapa
  /** Cómo se llama en el selector. */
  nombre: string
  /** Quién entra por ella. */
  quien: string
  /** Las audiencias que deja pasar. */
  ve: Audiencia[]
  /** Qué se queda fuera, dicho en una frase (vacío en la interna). */
  fuera: string
}

export const CAPAS: Capa[] = [
  {
    clave: 'interna',
    nombre: 'Interna',
    quien: 'El equipo de CLAUX',
    ve: ['usar', 'vender', 'operar', 'confidencial'],
    fuera: '',
  },
  {
    clave: 'vendedor',
    nombre: 'Vendedor',
    quien: 'El equipo comercial y los revendedores',
    ve: ['usar', 'vender'],
    fuera: 'Fuera queda el trabajo interno del equipo y lo confidencial: márgenes, costes y el alta del cliente.',
  },
  {
    clave: 'cliente',
    nombre: 'Cliente',
    quien: 'Cualquiera: el dueño de un negocio, un buscador',
    ve: ['usar'],
    fuera: 'Fuera queda todo lo comercial —argumentario, objeciones, precios— además de lo interno.',
  },
]

export const CAPA_POR_DEFECTO: ClaveCapa = 'interna'

/**
 * La capa que IMPONE un rol, o `null` si puede elegir.
 *
 * Un vendedor lee siempre en su capa: el manual completo lleva dentro márgenes,
 * costes y roadmap, y una cuenta de venta puede ser de un revendedor de fuera.
 * El super_admin elige, porque necesita ver el documento del vendedor tal cual
 * antes de entregar la cuenta.
 *
 * Devolver `null` y no `'interna'` no es lo mismo: `null` significa «manda la
 * cookie», y es lo que mantiene vivo el selector.
 */
export function capaDeRol(rol: RolAdmin): ClaveCapa | null {
  return rol === 'vendedor' ? 'vendedor' : null
}

/** Cookie donde se recuerda la capa. No es un permiso: es cómo se está mirando. */
export const COOKIE_CAPA = 'claux-academia-capa'

export function capaPorClave(valor?: string | null): Capa {
  return CAPAS.find(c => c.clave === valor) ?? CAPAS[0]
}
