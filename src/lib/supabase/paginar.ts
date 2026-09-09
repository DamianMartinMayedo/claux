// ────────────────────────────────────────────────────────────────────────────
// TRAER TODAS LAS FILAS DE UNA CONSULTA, aunque pasen del techo de PostgREST.
//
// ── EL PROBLEMA ───────────────────────────────────────────────────────────────
// PostgREST corta a **1.000 filas** toda consulta sin `.limit()` (`db-max-rows`,
// el valor por defecto de Supabase). No devuelve error ni aviso: devuelve 1.000
// filas y un `error: null`. Una consulta escrita para sumar la historia entera de
// una cuenta se queda en las primeras 1.000 y el código de arriba suma lo que le
// llega sin saber que le faltan filas.
//
// Lo que costó descubrirlo (2026-09-09): CLI-0008 tenía 1.410 liquidaciones, una
// por documento, y la consulta de `cobranza.ts` veía 1.000. Los 410 documentos
// restantes salían en **Cuentas por pagar** con su importe completo pendiente
// —9.536.689,44 de deuda que ya estaba pagada— con el pendiente real en cero. El
// mismo patrón estaba en Gastos y cobros, en los saldos de Tesorería, en la caja
// del panel y en el estado de resultados.
//
// ── POR QUÉ NO VALE SUBIR EL `.limit()` ───────────────────────────────────────
// El techo es del servidor: `.limit(5000)` devuelve 1.000 igual. La única salida
// por la API de datos es pedir las filas por páginas.
//
// ── POR QUÉ SE PIDE UNA COLUMNA DE ORDEN ──────────────────────────────────────
// Sin `order by`, Postgres no garantiza el mismo orden entre una página y la
// siguiente: paginar sobre un orden inestable duplica filas y se salta otras. Se
// pasa la clave primaria de la tabla (`movimiento_id`, `registro_id`…), que es
// única y por tanto determinista. NO hace falta que esté en el `select`.
//
// Se aceptan VARIAS columnas por si el orden importa de cara al usuario —una
// descarga sale ordenada por fecha— o por si la clave es compuesta: entonces se
// pasa `['fecha', 'registro_id']` y la última tiene que ser única. Ordenar solo
// por `fecha` no basta: los empates rompen el paginado igual que no ordenar.
//
// ── POR QUÉ AVANZA POR `lote.length` Y PARA EN CERO ───────────────────────────
// «Ha devuelto menos de lo que pedí» no significa «ya no hay más»: significa eso
// o que el techo del servidor es más bajo que la página. Avanzando por las filas
// realmente recibidas y parando solo cuando llegan CERO, el helper es correcto
// con cualquier techo (cuesta una petición extra vacía al final).
//
// ── POR QUÉ LANZA EN VEZ DE DEVOLVER LO QUE HAYA ──────────────────────────────
// Estas lecturas se convierten en cifras de dinero. Un saldo a medias no es un
// saldo peor: es un número falso que el dueño lee como un hecho. Si la lectura no
// se puede completar, tiene que verse, no maquillarse con un cero.
//
// Sin 'use server': es una utilidad de servidor que usan las server actions.
// ────────────────────────────────────────────────────────────────────────────

/** Filas por petición. Igual al techo por defecto de Supabase; si fuera menor, el
 *  bucle sigue siendo correcto (ver la cabecera). */
const PAGINA = 1000

/** Tope de seguridad: 50 páginas = 50.000 filas. Pasarse es un error de diseño
 *  —esa consulta necesita agregarse en SQL, no traerse—, así que lanza. */
const MAX_PAGINAS = 50

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Consulta = any

/**
 * Ejecuta la consulta por páginas y devuelve TODAS sus filas.
 *
 * @param clave    Columna única por la que ordenar el paginado (la PK de la tabla),
 *                 o varias cuando el orden visible importa o la clave es compuesta:
 *                 la ÚLTIMA tiene que ser única.
 * @param consulta Función que **construye** la consulta. Se llama una vez por
 *                 página: un `PostgrestBuilder` ya ejecutado no se puede reusar,
 *                 así que no vale pasar la consulta hecha.
 *
 * ```ts
 * const { data: movs } = await traerTodas<Mov>('movimiento_id', () =>
 *   db.from('movimientos_tesoreria').select('monto, tipo').eq('client_id', cid))
 * ```
 *
 * Devuelve la misma forma que Supabase (`{ data }`) para que el sitio de llamada
 * no cambie de lo que ya hacía.
 */
export async function traerTodas<T>(
  clave: string | string[],
  consulta: () => Consulta,
): Promise<{ data: T[] }> {
  // Sin repetidas: la PK puede coincidir con el orden visible que pide quien llama
  // (`['producto_id', 'producto_id', 'almacen_id']`), y ordenar dos veces por lo mismo
  // no aporta nada.
  const claves = [...new Set(Array.isArray(clave) ? clave : [clave])]
  const etiqueta = claves.join(' + ')
  const filas: T[] = []
  let desde = 0

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    let q = consulta()
    for (const c of claves) q = q.order(c, { ascending: true })
    const { data, error } = await q.range(desde, desde + PAGINA - 1)
    if (error) throw new Error(`lectura paginada (${etiqueta}): ${error.message}`)

    const lote = (data ?? []) as T[]
    if (lote.length === 0) return { data: filas }
    filas.push(...lote)
    desde += lote.length
  }

  throw new Error(
    `lectura paginada (${etiqueta}): más de ${MAX_PAGINAS * PAGINA} filas. ` +
    'Esta consulta tiene que agregarse en SQL, no traerse fila a fila.',
  )
}
