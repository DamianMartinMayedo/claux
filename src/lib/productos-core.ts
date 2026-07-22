// Núcleo del catálogo (sin 'use server'): generadores de código y construcción
// de campos de `products`. Lo comparten la server action `guardarProducto`
// (alta/edición manual) y el importador de datos, para que las reglas del tipo
// (unidad de servicio, suscribible, stock mínimo) vivan en UNA sola fuente.
//
// No valida permisos ni monedas: eso es del llamante (candado + `monedaValida`).

export type TipoProducto = 'PRODUCTO' | 'SERVICIO'

export function generarProductoId(tipo: TipoProducto): string {
  const pfx = tipo === 'SERVICIO' ? 'SRV' : 'PRD'
  return `${pfx}-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

/** Siguiente código visible del catálogo (PRD-0001 / SRV-0001) para un cliente. */
export async function siguienteCodigoProducto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db:        any,
  client_id: string,
  tipo:      TipoProducto,
): Promise<string> {
  const pfx = tipo === 'SERVICIO' ? 'SRV' : 'PRD'
  const { data } = await db
    .from('products')
    .select('codigo')
    .eq('client_id', client_id)
    .like('codigo', `${pfx}-%`)
    .order('codigo', { ascending: false })
    .limit(1)

  let num = 1
  if (data && data.length > 0) {
    const last = (data[0].codigo as string).split('-')
    const n    = parseInt(last[last.length - 1]) || 0
    num        = n + 1
  }
  return `${pfx}-${String(num).padStart(4, '0')}`
}

/**
 * Entrada plana para armar los campos de un producto/servicio. Viene de FormData
 * (alta manual) o de una fila de CSV mapeada (importador). Las reglas que dependen
 * del `tipo` se aplican aquí, no en el llamante.
 */
export interface ProductoInput {
  nombre:                string
  tipo:                  TipoProducto
  unidad?:               string | null
  codigo_proveedor?:     string | null
  descripcion?:          string | null
  categoria_id?:         string | null
  proveedor_id?:         string | null
  precios?:              Record<string, number>
  costos?:               Record<string, number>
  es_suscribible?:       boolean
  periodicidad_defecto?: string | null
  stock_minimo?:         number | null
}

/** Arma el objeto de campos que se inserta/actualiza en `products`. */
export function construirCamposProducto(input: ProductoInput) {
  const s = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim()
    return t || null
  }
  const esServicio = input.tipo === 'SERVICIO'
  const unidad     = (input.unidad ?? '').trim()
  return {
    nombre:           input.nombre.trim(),
    tipo:             input.tipo,
    // Servicio sin unidad → valor neutro, no se le pide al usuario (no siempre es medible).
    unidad:           esServicio ? (unidad || 'servicio') : unidad,
    codigo_proveedor: s(input.codigo_proveedor),
    descripcion:      s(input.descripcion),
    categoria_id:     s(input.categoria_id),
    proveedor_id:     s(input.proveedor_id),
    precios:          input.precios ?? {},
    costos:           input.costos  ?? {},
    // Suscribible solo aplica a servicios; un físico nunca lo es.
    es_suscribible:       esServicio && !!input.es_suscribible,
    periodicidad_defecto: esServicio ? s(input.periodicidad_defecto) : null,
    stock_minimo:     esServicio ? 0
      : (input.stock_minimo != null && !isNaN(input.stock_minimo) ? input.stock_minimo : 0),
    updated_at:       new Date().toISOString(),
  }
}
