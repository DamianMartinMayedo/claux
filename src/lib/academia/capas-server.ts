import 'server-only'
import { cookies } from 'next/headers'
import { COOKIE_CAPA, capaPorClave, capaDeRol, type Capa } from './capas'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import type { RolAdmin } from '@/lib/roles'

/**
 * Con qué capa se está mirando el manual.
 *
 * Dos fuentes, y el orden importa: **primero el rol, después la cookie**. Un
 * vendedor lee siempre en su capa (`capaDeRol`), así que ni el selector ni una
 * cookie escrita a mano en la consola del navegador le abren el manual interno.
 * Al super_admin no hay rol que le imponga nada y decide la cookie, que es el
 * selector «Ver como».
 *
 * La preferencia va en cookie y no en la URL a propósito: no es el filtro de un
 * listado, es el modo en que se lee TODO el manual, y meterlo en la query
 * obligaría a arrastrar el parámetro por los dieciocho enlaces del índice y por
 * cada ancla copiada. A cambio, la vista filtrada se anuncia siempre en
 * pantalla: un enlace no puede enseñar cosas distintas a dos personas sin
 * decirlo.
 *
 * `rol` es opcional para no obligar a resolver el contexto donde ya se sabe que
 * no hay sesión, pero **toda superficie que sirva contenido del manual tiene que
 * pasarlo** — incluida la que devuelve el índice de búsqueda, que si no daría
 * por JSON lo que la página ya no enseña.
 */
export async function capaActual(rol?: RolAdmin): Promise<Capa> {
  const impuesta = rol ? capaDeRol(rol) : null
  if (impuesta) return capaPorClave(impuesta)

  const galletas = await cookies()
  return capaPorClave(galletas.get(COOKIE_CAPA)?.value)
}

/** ¿Puede esta cuenta cambiar de capa? Si no, el selector no se pinta: enseñar
 *  tres pastillas de las que dos no funcionan es peor que no enseñar ninguna. */
export function puedeElegirCapa(rol: RolAdmin): boolean {
  return capaDeRol(rol) === null
}

/**
 * La capa de quien está leyendo, resolviendo su rol por el camino. Es lo que
 * usan las páginas del manual: la sesión ya está memorizada por petición, así
 * que preguntarla aquí no cuesta una consulta más.
 *
 * Sin sesión devuelve la capa más cerrada, no la de por defecto. No debería
 * ocurrir —el layout redirige antes—, pero si algún día una superficie del
 * manual se sirviera sin guard, el fallo sería enseñar de menos.
 */
export async function capaDeSesion(): Promise<Capa> {
  const ctx = await obtenerContextoAdmin()
  if (!ctx) return capaPorClave('cliente')
  return capaActual(ctx.rol)
}
