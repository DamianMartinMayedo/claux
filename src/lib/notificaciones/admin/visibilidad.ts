// Quién ve qué aviso. Puro (sin servidor) para que lo compartan las acciones y la
// página: la bandeja se abre si tienes algo que ver en ella, y eso hay que
// decidirlo en los dos sitios con la MISMA regla.

import type { ContextoAdmin, SeccionKey } from '@/lib/roles'
import { CATALOGO_ADMIN, type TipoAvisoClave } from './catalogo'

/**
 * Tipos que este admin puede ver. Se traduce a un `in('tipo', …)` en la query en
 * vez de filtrar por la columna `seccion`: así el catálogo (código) es la fuente
 * de verdad y no dependemos de que la fila guardara bien su sección.
 *
 * `seccion: null` = aviso de plataforma: solo super_admin.
 */
export function tiposVisibles(ctx: ContextoAdmin): TipoAvisoClave[] {
  const todos = Object.keys(CATALOGO_ADMIN) as TipoAvisoClave[]
  if (ctx.rol === 'super_admin') return todos
  return todos.filter(t => {
    const seccion = CATALOGO_ADMIN[t].seccion
    return seccion !== null && ctx.permisos.includes(seccion as SeccionKey)
  })
}
