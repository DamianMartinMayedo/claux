// Núcleo de gastos y cobros (sin 'use server'): generador de código y la regla
// de la ETIQUETA. Lo comparten la server action `guardarGastoCobro` (alta manual)
// y el importador de datos.
//
// La regla (mig. 126): un GASTO se identifica por su categoría —obligatoria— y su
// etiqueta (columna `descripcion`) se DERIVA como «Categoría · Subcategoría»; el
// texto libre va en `notas`. Un COBRO lleva concepto de texto libre y no lleva
// categoría. Es la clase de regla que si se copia en dos sitios, se separa.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type TipoRegistro = 'GASTO' | 'COBRO'

export function generarRegistroId(tipo: TipoRegistro): string {
  const pre = tipo === 'GASTO' ? 'GAS' : 'COB'
  return `${pre}-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

export interface EtiquetaCategoria {
  categoria_id: string
  /** Nombre de la categoría elegida (desnormalizado en `gastos_cobros.categoria`). */
  nombre:       string
  /** Etiqueta derivada: «Categoría» o «Categoría · Subcategoría». */
  descripcion:  string
}

/**
 * Resuelve la etiqueta de un gasto a partir de su categoría (subiendo al padre si
 * es una subcategoría). Devuelve null si la categoría no existe o está inactiva.
 */
export async function etiquetaDeCategoria(
  db: Db, client_id: string, categoria_id: string,
): Promise<EtiquetaCategoria | null> {
  const { data: nodo } = await db.from('categorias_gastos')
    .select('nombre, parent_id, estado')
    .eq('categoria_id', categoria_id).eq('client_id', client_id)
    .maybeSingle()
  if (!nodo || nodo.estado !== 'ACTIVO') return null

  let descripcion = nodo.nombre as string
  if (nodo.parent_id) {
    const { data: padre } = await db.from('categorias_gastos')
      .select('nombre').eq('categoria_id', nodo.parent_id).eq('client_id', client_id).maybeSingle()
    if (padre) descripcion = `${padre.nombre} · ${nodo.nombre}`
  }
  return { categoria_id, nombre: nodo.nombre as string, descripcion }
}

// ── Categorías que escribe el SISTEMA ────────────────────────────────────────
//
// Las cuatro categorías que no nacen de un formulario sino de un módulo. Su
// identidad es la CLAVE (`categorias_gastos.clave_sistema`, mig. 133), nunca el
// nombre: el dueño puede renombrarlas y buscarlas por nombre crearía un duplicado
// a su espalda en la siguiente escritura — el bug de datos de la mig. 122.

export type ClaveCategoriaSistema =
  | 'compras'               // entrada de mercancía (inv_confirmar_compra)
  | 'servicios_terceros'    // CxP al proveedor de un servicio (srv_cxp_generar)
  | 'salarios'              // nómina confirmada
  | 'comisiones_bancarias'  // fees de transferencia

const NOMBRE_DEFECTO: Record<ClaveCategoriaSistema, string> = {
  compras:              'Compras',
  servicios_terceros:   'Servicios de terceros',
  salarios:             'Salarios',
  comisiones_bancarias: 'Comisiones bancarias',
}

/**
 * Resuelve —creándola si hace falta— la categoría de sistema de este cliente.
 *
 * Delega en la RPC `cat_gasto_sistema` (mig. 133) para que Postgres y TypeScript
 * compartan UNA sola implementación: la misma que usan por dentro
 * `inv_confirmar_compra` y `srv_cxp_generar`. Antes cada llamador hacía su propio
 * `select ... eq('nombre', 'Salarios')`, y como las categorías del sistema solo se
 * sembraron para los clientes que existían en la mig. 074, un cliente dado de alta
 * después escribía el gasto sin `categoria_id` — invisible para el P&L estructurado.
 *
 * Devuelve null solo si la RPC falla; el llamador debe seguir escribiendo el gasto
 * (un gasto sin clasificar es mejor que una nómina que no se confirma).
 */
export async function resolverCategoriaSistema(
  db: Db, client_id: string, clave: ClaveCategoriaSistema,
): Promise<{ categoria_id: string; nombre: string } | null> {
  const nombreDefecto = NOMBRE_DEFECTO[clave]
  const { data: categoria_id, error } = await db.rpc('cat_gasto_sistema', {
    p_client_id: client_id, p_clave: clave, p_nombre: nombreDefecto,
  })
  if (error || !categoria_id) return null

  // El nombre puede estar renombrado por el dueño: es el que se desnormaliza.
  const { data: cat } = await db.from('categorias_gastos')
    .select('nombre').eq('categoria_id', categoria_id).eq('client_id', client_id).maybeSingle()
  return { categoria_id: categoria_id as string, nombre: (cat?.nombre as string) ?? nombreDefecto }
}
