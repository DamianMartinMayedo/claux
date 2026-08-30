import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { COLUMNAS_PRECIO, NIVELES, precioModulo, type Nivel, type ModuloPrecios } from '@/lib/niveles'
import { MONEDAS_CLAUX, type MonedaClaux } from '@/lib/moneda-claux'
import { nombresDeNiveles } from '@/lib/niveles-server'

/**
 * Lo que el manual NO teclea: nombre comercial, precios y estado de cada cosa
 * que se vende. Se leen de `modulos_catalogo` —la misma tabla que usa el
 * producto para ofrecer y cobrar—, así que el manual no puede contradecir al
 * sistema: se sube un precio en `/admin/modulos` y la ficha lo dice al recargar.
 *
 * Desde los niveles comerciales hay tres precios por módulo, uno por nivel, y
 * desde el euro (mig. 225) son SEIS: moneda × nivel. El manual lleva las dos
 * monedas porque quien vende elige en cuál presupuesta, y el nombre de cada
 * nivel también es dato editable (`niveles.nombre`): el manual de ventas no
 * puede llevar «Fundador» escrito a mano el día que el dueño lo renombre.
 *
 * El esqueleto (orden de lectura, ficha en Markdown, páginas) sigue en
 * `catalogo.ts`: eso es criterio editorial, no dato del producto.
 *
 * Si la consulta falla o la fila no existe, la ficha se pinta **sin precio** en
 * lugar de con uno inventado: en un manual de ventas, un número equivocado hace
 * más daño que un hueco.
 */

export type PrecioCatalogo = {
  nombre: string
  /** Un importe por moneda y nivel; los niveles, en el orden de `NIVELES`. */
  precios: Record<MonedaClaux, Record<Nivel, number>>
  /** `false` = archivada en el admin: existe pero no se vende. */
  activo: boolean
}

export type PreciosAcademia = {
  modulos: Record<string, PrecioCatalogo>
  /** Cómo se llama hoy cada nivel, para no escribirlo a mano en la ficha. */
  nombresNivel: Record<Nivel, string>
}

export const preciosDelCatalogo = cache(async (): Promise<PreciosAcademia> => {
  const db = createAdminClient()
  const [{ data, error }, nombresNivel] = await Promise.all([
    db.from('modulos_catalogo')
      .select(`clave, nombre, ${COLUMNAS_PRECIO}, activo`),
    nombresDeNiveles(),
  ])

  if (error || !data) {
    console.error('[academia] no se pudo leer modulos_catalogo:', error)
    return { modulos: {}, nombresNivel }
  }

  const modulos: Record<string, PrecioCatalogo> = {}
  for (const fila of data) {
    modulos[fila.clave] = {
      nombre: fila.nombre,
      // Postgres devuelve `numeric` como texto: sin Number() se concatenaría.
      precios: Object.fromEntries(
        MONEDAS_CLAUX.map(m => [m, Object.fromEntries(
          NIVELES.map(n => [n, precioModulo(fila as ModuloPrecios, n, m)]),
        )]),
      ) as Record<MonedaClaux, Record<Nivel, number>>,
      activo: fila.activo,
    }
  }
  return { modulos, nombresNivel }
})

/**
 * Cómo se llama hoy cada nivel. Sale de la MISMA lectura que los precios (React
 * `cache()`), así que la vista del manual entero —cincuenta fichas de una tirada—
 * no dispara cincuenta consultas por un puñado de rótulos.
 */
export async function nombresNivelManual(): Promise<Record<Nivel, string>> {
  return (await preciosDelCatalogo()).nombresNivel
}
