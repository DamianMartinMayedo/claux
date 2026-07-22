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
