'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { monedaValida }      from '@/lib/tasas'
import { getPortalSession, puedeEditarModulo, puedeEditarAlgunModulo }  from './auth'
import { obtenerEmpresas }    from './empresas'
import { MODULOS_CATALOGO, tieneModulo } from '@/lib/modulos'
import { etiquetasDe }        from '@/lib/sector'
import { parseNumeroEs }      from '@/lib/numeros'
import {
  calcularCobro, estadoEfectivo,
  type PeriodicidadSub, type DescuentoModo, type EstadoSub,
} from '@/lib/suscripciones'
import { aplicarMovimiento, stockEnAlmacen, type TipoMovimiento } from './_inventario-helpers'
import {
  generarProductoId, generarCategoriaProductoId, siguienteCodigoProducto, construirCamposProducto,
  type TipoProducto as _TipoProducto,
} from '@/lib/productos-core'

// ── Tipos ─────────────────────────────────────────────────────────────────────

// El tipo y los helpers del catálogo viven en `@/lib/productos-core` (una sola
// fuente, compartida con el importador). Se re-declara directamente porque el
// re-export agregado `export type { … } from …` rompe el loader de 'use server'.
export type TipoProducto = _TipoProducto

/** Para qué sirve una categoría. `AMBAS` = vale para físicos y para servicios. */
export type TipoCategoria = TipoProducto | 'AMBAS'

export interface Categoria {
  categoria_id: string
  client_id:    string
  nombre:       string
  descripcion:  string | null
  tipo:         TipoCategoria
  estado:       'ACTIVO' | 'INACTIVO'
  created_at:   string
  updated_at:   string
}

export interface Producto {
  producto_id:      string
  client_id:        string
  codigo:           string
  codigo_proveedor: string | null
  nombre:           string
  descripcion:      string | null
  tipo:             TipoProducto
  categoria_id:     string | null
  proveedor_id:     string | null
  unidad:           string
  es_suscribible:   boolean
  periodicidad_defecto: string | null
  precios:          Record<string, number>  // { USD: 25.00, CUP: 9000 }
  costos:           Record<string, number>
  stock_actual:     number
  stock_minimo:     number
  estado:           'ACTIVO' | 'INACTIVO'
  created_at:       string
  updated_at:       string
}

export interface ProductosPageData {
  productos:   Producto[]
  /** Qué cataloga esta página: PRODUCTO (Inventario) o SERVICIO (módulo Servicios).
   *  Inventario y Servicios comparten la tabla `products` pero NO la página. */
  modo:        TipoProducto
  categorias:  Categoria[]
  /** Con `empresa_id`: `third_parties` es por-empresa (mig. 008), así que el MISMO
   *  proveedor real puede tener una ficha en cada empresa. Sin distinguirlas, el
   *  desplegable las enseñaba como un duplicado exacto. */
  proveedores: { tercero_id: string; nombre: string; empresa_id: string }[]
  monedas:     string[]   // códigos de monedas activas del cliente, ej: ['USD','CUP']
  almacenes:   { almacen_id: string; nombre: string }[]
  /** Empresas visibles para este usuario (obtenerEmpresas ya filtra por rol). Sirve
   *  para agrupar/etiquetar los proveedores por empresa cuando hay más de una. */
  empresas:    { empresa_id: string; nombre: string }[]
  /**
   * Reparto por almacén de cada producto, con el mínimo que aplica en cada uno
   * (mig. 153). Con varias empresas el total consolidado no responde a ninguna
   * pregunta: 217 unidades «de sobra» pueden esconder un −3 en un local.
   * Vacío si el cliente no tiene `inventario`.
   */
  stockPorAlmacen: Record<string, { almacen_id: string; nombre: string; cantidad: number; minimo: number | null }[]>
  /** Con `inventario`: existencias, almacenes y productos físicos. Sin él (pieza
   *  `servicios` a secas) la página es solo la lista de servicios con su precio. */
  tieneInventario: boolean
  /** Etiqueta del sector para «servicio» (Servicio, Tratamiento, Clase…). */
  etiquetaServicio: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * ¿Este cliente tiene el módulo `inventario` (y no solo la pieza `servicios`)?
 * Decide dos cosas: si puede crear productos FÍSICOS y si la UI enseña existencias.
 * Devuelve también la etiqueta de «servicio» del sector, que casi siempre se pide a
 * la vez (una consulta menos).
 */
async function contextoCatalogo(
  clientId: string,
): Promise<{ tieneInventario: boolean; etiquetaServicio: string }> {
  const db = createAdminClient()
  const { data } = await db.from('clients')
    .select('modulos_activos, sector').eq('client_id', clientId).single()
  const { data: plantilla } = data?.sector
    ? await db.from('plantillas_sector').select('etiquetas').eq('sector', data.sector).maybeSingle()
    : { data: null }
  return {
    tieneInventario:  tieneModulo(data?.modulos_activos, 'inventario'),
    etiquetaServicio: etiquetasDe(plantilla?.etiquetas).servicio,
  }
}

// ── Obtener ───────────────────────────────────────────────────────────────────

export async function obtenerProductos(modo: TipoProducto = 'PRODUCTO'): Promise<ProductosPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  // obtenerEmpresas() ya resuelve el acceso por rol (admin_empresa ve todas; un
  // usuario, solo las asignadas): proveedores y almacenes se acotan a esas mismas
  // empresas, igual que en Compras y Ventas — no a todo el client_id.
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [prodRes, catRes, provRes, monRes, almRes, stkRes, cfgRes, ctx] = await Promise.all([
    db.from('products')
      .select('*')
      .eq('client_id', session.client_id)
      .eq('tipo', modo)          // Inventario ve físicos; Servicios ve servicios
      .order('nombre'),
    // Y sus categorías: en Servicios no se ofrece «Limpieza», y en Inventario no se
    // ofrece «Consultoría». Las marcadas AMBAS salen en las dos páginas (mig. 122).
    db.from('product_categories')
      .select('*')
      .eq('client_id', session.client_id)
      .in('tipo', [modo, 'AMBAS'])
      .order('nombre'),
    db.from('third_parties')
      .select('tercero_id, nombre, empresa_id')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .in('tipo', ['PROVEEDOR', 'AMBOS'])
      .eq('activo', true)
      .order('nombre'),
    db.from('monedas')
      .select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('codigo'),
    db.from('almacenes')
      .select('almacen_id, nombre')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .eq('activo', true)
      .order('nombre'),
    db.from('stock_almacenes')
      .select('producto_id, almacen_id, cantidad')
      .eq('client_id', session.client_id),
    db.from('producto_almacen_config')
      .select('producto_id, almacen_id, stock_minimo')
      .eq('client_id', session.client_id),
    // Sin `inventario` la página es solo la lista de servicios: ni existencias, ni
    // almacenes, ni tipo. La etiqueta la pone el sector (Servicio / Tratamiento /
    // Clase…), nunca se hornea en el código (MODELO-MODULOS §6).
    contextoCatalogo(session.client_id),
  ])

  const productos = (prodRes.data ?? []).map((p: Record<string, unknown>) => ({
    ...p,
    precios:      (typeof p.precios === 'object' && p.precios !== null) ? p.precios : {},
    costos:       (typeof p.costos  === 'object' && p.costos  !== null) ? p.costos  : {},
    stock_actual: Number(p.stock_actual) || 0,
    stock_minimo: Number(p.stock_minimo) || 0,
  })) as Producto[]

  const monedas   = (monRes.data ?? []).map((m: { codigo: string }) => m.codigo)
  const almacenes = (almRes.data ?? []) as { almacen_id: string; nombre: string }[]

  // Reparto por almacén, indexado por producto. Solo almacenes vivos: uno archivado
  // sigue teniendo filas de stock y saldría como un código crudo («ALM-5EED03»).
  const nombreAlm = new Map(almacenes.map(a => [a.almacen_id, a.nombre]))
  const minimoDe  = new Map(
    ((cfgRes.data ?? []) as { producto_id: string; almacen_id: string; stock_minimo: number | null }[])
      .filter(c => c.stock_minimo != null)
      .map(c => [`${c.producto_id}@${c.almacen_id}`, Number(c.stock_minimo)]),
  )
  const stockPorAlmacen: ProductosPageData['stockPorAlmacen'] = {}
  for (const s of (stkRes.data ?? []) as { producto_id: string; almacen_id: string; cantidad: number }[]) {
    const nombre = nombreAlm.get(s.almacen_id)
    if (!nombre) continue
    ;(stockPorAlmacen[s.producto_id] ??= []).push({
      almacen_id: s.almacen_id,
      nombre,
      cantidad:   Number(s.cantidad),
      minimo:     minimoDe.get(`${s.producto_id}@${s.almacen_id}`) ?? null,
    })
  }
  // Y los almacenes con mínimo configurado pero sin fila de stock: están a cero, que
  // es justo el caso que hay que enseñar.
  for (const [clave, minimo] of minimoDe) {
    const [producto_id, almacen_id] = clave.split('@')
    const nombre = nombreAlm.get(almacen_id)
    if (!nombre) continue
    const filas = (stockPorAlmacen[producto_id] ??= [])
    if (!filas.some(f => f.almacen_id === almacen_id)) {
      filas.push({ almacen_id, nombre, cantidad: 0, minimo })
    }
  }
  for (const filas of Object.values(stockPorAlmacen)) filas.sort((a, b) => b.cantidad - a.cantidad)

  return {
    productos,
    modo,
    categorias:  (catRes.data  ?? []) as Categoria[],
    proveedores: (provRes.data ?? []) as ProductosPageData['proveedores'],
    monedas:     monedas.length ? monedas : ['USD'],   // fallback si no hay monedas configuradas
    almacenes,
    empresas:    empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    stockPorAlmacen,
    ...ctx,
  }
}

// ── Guardar producto ──────────────────────────────────────────────────────────

export async function guardarProducto(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; producto_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }

  const nombre = ((formData.get('nombre') as string) ?? '').trim()
  if (!nombre) return { ok: false, error: 'El nombre es obligatorio.' }

  const tipo = ((formData.get('tipo') as string) ?? '').trim() as TipoProducto
  if (!['PRODUCTO', 'SERVICIO'].includes(tipo))
    return { ok: false, error: 'Tipo inválido.' }

  // Gate PRECISO por tipo: los físicos son del módulo Inventario; los servicios,
  // del módulo Servicios. Desde la separación total cada página crea un solo tipo,
  // pero el candado real está aquí (la UI oculta no es control de acceso): sin él,
  // un POST a mano colaría un tipo del módulo que el cliente no paga.
  const moduloDelTipo = tipo === 'SERVICIO' ? 'servicios' : 'inventario'
  if (!(await puedeEditarModulo(moduloDelTipo)))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const unidad = ((formData.get('unidad') as string) ?? '').trim()
  // La unidad solo es obligatoria para físicos; un servicio no siempre es medible.
  if (tipo === 'PRODUCTO' && !unidad) return { ok: false, error: 'La unidad es obligatoria.' }

  const db = createAdminClient()

  let precios: Record<string, number> = {}
  let costos:  Record<string, number> = {}
  try { precios = JSON.parse((formData.get('precios') as string) ?? '{}') } catch { /* ok */ }
  try { costos  = JSON.parse((formData.get('costos')  as string) ?? '{}') } catch { /* ok */ }

  const producto_id_form = ((formData.get('producto_id') as string) ?? '').trim()

  // Las reglas por tipo (unidad de servicio, suscribible, stock mínimo) las
  // aplica el núcleo compartido con el importador (`@/lib/productos-core`).
  const campos = construirCamposProducto({
    nombre,
    tipo,
    unidad,
    codigo_proveedor:     (formData.get('codigo_proveedor')     as string) ?? null,
    descripcion:          (formData.get('descripcion')          as string) ?? null,
    categoria_id:         (formData.get('categoria_id')         as string) ?? null,
    proveedor_id:         (formData.get('proveedor_id')         as string) ?? null,
    precios,
    costos,
    es_suscribible:       (formData.get('es_suscribible')       as string) === '1',
    periodicidad_defecto: (formData.get('periodicidad_defecto') as string) ?? null,
    stock_minimo:         parseNumeroEs(formData.get('stock_minimo') as string),
  })

  if (!producto_id_form) {
    // Un producto FÍSICO necesita un almacén donde registrar su stock (un servicio
    // no). Guard de servidor además del bloqueo en la UI: no se crea un físico sin
    // que exista al menos un almacén.
    if (tipo === 'PRODUCTO') {
      const { count } = await db.from('almacenes')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', session.client_id)
      if (!count) return { ok: false, error: 'Crea un almacén antes de registrar productos físicos.' }
    }
    const producto_id = generarProductoId(tipo)
    const codigo      = await siguienteCodigoProducto(db, session.client_id, tipo)

    const { error } = await db.from('products').insert({
      producto_id,
      client_id:    session.client_id,
      codigo,
      estado:       'ACTIVO',
      stock_actual: 0,
      created_at:   new Date().toISOString(),
      ...campos,
    })
    if (error) {
      console.error('[productos] insert error:', error)
      return { ok: false, error: `Error al crear: ${error.message}` }
    }
    revalidarFicha(moduloDelTipo)
    return { ok: true, producto_id }
  }

  // Obtener precios/costos actuales antes de actualizar (para el historial)
  let oldPrecios: Record<string, number> = {}
  let oldCostos:  Record<string, number> = {}
  const { data: current } = await db.from('products')
    .select('precios, costos')
    .eq('producto_id', producto_id_form)
    .eq('client_id', session.client_id)
    .maybeSingle()
  if (current) {
    oldPrecios = (typeof current.precios === 'object' && current.precios !== null) ? current.precios as Record<string, number> : {}
    oldCostos  = (typeof current.costos  === 'object' && current.costos  !== null) ? current.costos  as Record<string, number> : {}
  }

  const { error } = await db
    .from('products')
    .update(campos)
    .eq('producto_id', producto_id_form)
    .eq('client_id', session.client_id)

  if (error) {
    console.error('[productos] update error:', error)
    return { ok: false, error: 'Error al actualizar.' }
  }

  // Registrar cambios de precio/costo en el historial
  const monedasChanged = new Set(Object.keys({ ...precios, ...costos, ...oldPrecios, ...oldCostos }))
  for (const moneda of monedasChanged) {
    const nuevoPrecio = precios[moneda]
    const viejoPrecio = oldPrecios[moneda]
    const nuevoCosto  = costos[moneda]
    const viejoCosto  = oldCostos[moneda]
    if (nuevoPrecio !== viejoPrecio || nuevoCosto !== viejoCosto) {
      await db.from('producto_precios_historial').insert({
        historial_id: `HIS-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`,
        client_id:    session.client_id,
        producto_id:  producto_id_form,
        moneda,
        precio:       nuevoPrecio ?? null,
        costo:        nuevoCosto ?? null,
      })
    }
  }
  revalidarFicha(moduloDelTipo)
  return { ok: true, producto_id: producto_id_form }
}

// ── Archivar / restaurar producto ─────────────────────────────────────────────

// El módulo al que pertenece una ficha, por su TIPO. Archivar y eliminar gatean
// como guardarProducto: con el gate compartido de MODULOS_CATALOGO, un cliente
// solo de Servicios no podía crear ni editar un producto físico pero SÍ
// archivarlo o eliminarlo, y la UI oculta no es control de acceso.
// El `puedeEditarModulo` va INLINE en cada acción, no aquí: `audit-gating` lee el
// cuerpo de la acción y un candado escondido en un helper le pasa desapercibido.
// No se exporta: en un fichero 'use server' todo export es un endpoint HTTP.
/**
 * La ficha vive en DOS páginas según su tipo (`/portal/productos` para el físico,
 * `/portal/servicios` para el servicio), y hasta ahora todas las acciones revalidaban solo
 * la de Inventario. Hoy es inocuo —las dos páginas son `force-dynamic` y las vistas llaman
 * a `router.refresh()`—, pero es una trampa dormida: el día que una de las dos se cachee,
 * guardar un servicio dejaría la lista de Servicios con los datos viejos.
 *
 * Sin módulo (un lote puede mezclar tipos) se revalidan las dos: revalidar de más no
 * rompe nada, revalidar de menos enseña datos viejos.
 */
function revalidarFicha(modulo?: 'inventario' | 'servicios' | null) {
  if (modulo !== 'servicios')  revalidatePath('/portal/productos')
  if (modulo !== 'inventario') revalidatePath('/portal/servicios')
}

async function moduloDeProducto(client_id: string, producto_id: string): Promise<'inventario' | 'servicios' | null> {
  const db = createAdminClient()
  const { data: prod } = await db.from('products')
    .select('tipo').eq('producto_id', producto_id).eq('client_id', client_id).maybeSingle()
  if (!prod) return null
  return prod.tipo === 'SERVICIO' ? 'servicios' : 'inventario'
}

export async function archivarProducto(
  producto_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  const modulo = await moduloDeProducto(session.client_id, producto_id)
  if (!modulo) return { ok: false, error: 'Producto no encontrado.' }
  if (!(await puedeEditarModulo(modulo)))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db
    .from('products')
    .update({ estado: 'INACTIVO', updated_at: new Date().toISOString() })
    .eq('producto_id', producto_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al archivar.' }
  revalidarFicha(modulo)
  return { ok: true }
}

export async function restaurarProducto(
  producto_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  const modulo = await moduloDeProducto(session.client_id, producto_id)
  if (!modulo) return { ok: false, error: 'Producto no encontrado.' }
  if (!(await puedeEditarModulo(modulo)))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db
    .from('products')
    .update({ estado: 'ACTIVO', updated_at: new Date().toISOString() })
    .eq('producto_id', producto_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al restaurar.' }
  revalidarFicha(modulo)
  return { ok: true }
}

// Eliminar DEFINITIVAMENTE un producto ya archivado. No hay FKs a `products`
// (acople suelto por producto_id texto), así que comprobamos a mano que no deje
// historial huérfano: si tiene ventas, compras, movimientos, está en el catálogo
// público o en tickets de caja, se mantiene archivado. Solo se borran sus datos
// propios (historial de precios y stock por almacén) junto con el producto.
export async function eliminarProducto(
  producto_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  const modulo = await moduloDeProducto(session.client_id, producto_id)
  if (!modulo) return { ok: false, error: 'Producto no encontrado.' }
  if (!(await puedeEditarModulo(modulo)))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { data: prod } = await db
    .from('products')
    .select('estado')
    .eq('producto_id', producto_id)
    .eq('client_id', session.client_id)
    .single()
  if (!prod)                     return { ok: false, error: 'Producto no encontrado.' }
  if (prod.estado !== 'INACTIVO') return { ok: false, error: 'Archiva el producto antes de eliminarlo.' }

  // `documento_lineas` es la única sin client_id (mig. 014: cuelga del documento,
  // no del cliente), así que ahí la comprobación se queda por producto_id. En las
  // demás se filtra: producto_id no tiene índice único en producción y un código
  // repetido entre tenants bloquearía —o peor, dejaría pasar— el borrado ajeno.
  const dependencias: { tabla: string; etiqueta: string; conClientId: boolean }[] = [
    { tabla: 'documento_lineas',       etiqueta: 'ventas u ofertas',             conClientId: false },
    { tabla: 'compra_lineas',          etiqueta: 'compras',                      conClientId: true  },
    { tabla: 'movimientos_inventario', etiqueta: 'movimientos de inventario',    conClientId: true  },
    { tabla: 'catalogo_items',         etiqueta: 'tu catálogo público',          conClientId: true  },
    { tabla: 'caja_ticket_lineas',     etiqueta: 'tickets de caja',              conClientId: true  },
    // Un servicio contratado no se borra: sin esta guarda se archivaba, se eliminaba y el
    // acuerdo seguía vivo facturando una línea llamada «—».
    { tabla: 'suscripcion_lineas',     etiqueta: 'suscripciones',                conClientId: true  },
    // El vínculo con Citas (mig. 119) es BLANDO y en una dirección, pero borrar el
    // producto deja el enlace colgando y la agenda enseñando un servicio sin catálogo.
    { tabla: 'servicios',              etiqueta: 'servicios de tu agenda',       conClientId: true  },
  ]
  for (const d of dependencias) {
    let q = db.from(d.tabla).select('*', { count: 'exact', head: true }).eq('producto_id', producto_id)
    if (d.conClientId) q = q.eq('client_id', session.client_id)
    const { count } = await q
    if ((count ?? 0) > 0) {
      return { ok: false, error: `No se puede eliminar: tiene ${d.etiqueta} asociadas. Se mantiene archivado.` }
    }
  }

  await db.from('producto_precios_historial').delete()
    .eq('client_id', session.client_id).eq('producto_id', producto_id)
  await db.from('stock_almacenes').delete()
    .eq('client_id', session.client_id).eq('producto_id', producto_id)
  const { error } = await db
    .from('products')
    .delete()
    .eq('producto_id', producto_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'Error al eliminar.' }

  revalidarFicha(modulo)
  return { ok: true }
}

/**
 * Escribe la tarifa de un servicio **solo en la moneda que está vacía**.
 *
 * El catálogo se rellena con el USO REAL: 55 de 63 líneas de acuerdo apuntan a un
 * servicio sin precio en la moneda del acuerdo, porque el precio se decide al pactar, no
 * en el catálogo. Cuando el dueño teclea uno, se le ofrece guardarlo también como tarifa
 * (casilla desmarcada); a partir del segundo acuerdo de ese servicio en esa moneda, ya
 * precarga solo.
 *
 * **No puede reutilizar `guardarProducto`**, que reescribe `precios` ENTERO desde el
 * formulario: esta acción fusiona por moneda y **se niega si esa moneda ya tiene
 * importe**. Nunca pisa una tarifa pactada ni borra las demás — es la misma regla que el
 * importador llama «ACTUALIZAR no vacía».
 */
export async function guardarTarifaSiVacia(
  producto_id: string, moneda: string, precio: number,
): Promise<{ ok: boolean; error?: string; escrito?: boolean }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('servicios')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!moneda || !(precio > 0)) return { ok: false, error: 'Precio o moneda no válidos.' }

  const db = createAdminClient()
  // La moneda, siempre de las del negocio: una que no tiene no cotiza.
  if (!(await monedaValida(db, session.client_id, moneda)))
    return { ok: false, error: 'Esa moneda no está activa en tu negocio.' }

  const { data: prod } = await db.from('products')
    .select('precios, tipo').eq('producto_id', producto_id)
    .eq('client_id', session.client_id).maybeSingle()
  if (!prod) return { ok: false, error: 'Servicio no encontrado.' }
  if (prod.tipo !== 'SERVICIO') return { ok: false, error: 'Solo se tarifan servicios por esta vía.' }

  const actuales = (typeof prod.precios === 'object' && prod.precios !== null)
    ? prod.precios as Record<string, number> : {}
  // Ya tiene tarifa ahí: no se toca y se dice. No es un error — el acuerdo se guarda igual.
  if (Number(actuales[moneda]) > 0) return { ok: true, escrito: false }

  const { error } = await db.from('products')
    .update({ precios: { ...actuales, [moneda]: precio }, updated_at: new Date().toISOString() })
    .eq('producto_id', producto_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo guardar la tarifa.' }

  revalidarFicha('servicios')
  return { ok: true, escrito: true }
}

// ── Acciones en lote (Fase 1) ───────────────────────────────────────────────────
//
// Candado `inventario` inline (audit-gating). Archivar/restaurar es un UPDATE
// atómico del estado. Eliminar REUTILIZA la acción individual en bucle: conserva
// sus guardas (INACTIVO + sin ventas/compras/movimientos/catálogo/caja) y reporta
// las que se omiten con su motivo, en vez de borrar a ciegas.

export interface ResultadoLoteProductos {
  ok: boolean
  hechas: number
  omitidas: { nombre: string; motivo: string }[]
  error?: string
}

export async function archivarProductosEnLote(
  ids: string[], archivar: boolean,
): Promise<ResultadoLoteProductos> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, hechas: 0, omitidas: [], error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(MODULOS_CATALOGO))) return { ok: false, hechas: 0, omitidas: [], error: 'No tienes permiso para editar en este módulo.' }
  if (!ids.length) return { ok: true, hechas: 0, omitidas: [] }

  const db = createAdminClient()

  // Candado por tipo, como en la acción individual: el lote no puede ser la vía
  // por la que se archiva lo que no se puede editar de uno en uno.
  const { data: prods } = await db.from('products')
    .select('producto_id, nombre, tipo').eq('client_id', session.client_id).in('producto_id', ids)
  const filas = (prods ?? []) as { producto_id: string; nombre: string; tipo: string }[]
  const [puedeInv, puedeSrv] = await Promise.all([
    puedeEditarModulo('inventario'), puedeEditarModulo('servicios'),
  ])
  const permitidos = filas.filter(p => (p.tipo === 'SERVICIO' ? puedeSrv : puedeInv))
  const omitidas   = filas
    .filter(p => !(p.tipo === 'SERVICIO' ? puedeSrv : puedeInv))
    .map(p => ({ nombre: p.nombre, motivo: 'No tienes permiso para editar en este módulo.' }))
  if (!permitidos.length) return { ok: true, hechas: 0, omitidas }

  const { data, error } = await db.from('products')
    .update({ estado: archivar ? 'INACTIVO' : 'ACTIVO', updated_at: new Date().toISOString() })
    .eq('client_id', session.client_id).in('producto_id', permitidos.map(p => p.producto_id))
    .select('producto_id')
  if (error) return { ok: false, hechas: 0, omitidas: [], error: error.message }
  revalidarFicha()   // el lote puede mezclar productos y servicios
  return { ok: true, hechas: (data ?? []).length, omitidas }
}

export async function eliminarProductosEnLote(ids: string[]): Promise<ResultadoLoteProductos> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, hechas: 0, omitidas: [], error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(MODULOS_CATALOGO))) return { ok: false, hechas: 0, omitidas: [], error: 'No tienes permiso para editar en este módulo.' }
  if (!ids.length) return { ok: true, hechas: 0, omitidas: [] }

  const db = createAdminClient()
  const { data: prods } = await db.from('products')
    .select('producto_id, nombre').eq('client_id', session.client_id).in('producto_id', ids)
  const nombreDe = new Map((prods ?? []).map(p => [p.producto_id as string, p.nombre as string]))

  const res: ResultadoLoteProductos = { ok: true, hechas: 0, omitidas: [] }
  for (const id of ids) {
    if (!nombreDe.has(id)) continue
    const r = await eliminarProducto(id)   // conserva guardas de dependencias
    if (r.ok) res.hechas++
    else res.omitidas.push({ nombre: nombreDe.get(id) ?? id, motivo: r.error ?? 'No se pudo eliminar' })
  }
  revalidarFicha()   // el lote puede mezclar productos y servicios
  return res
}

// ── Ajuste de stock (por almacén, vía movimiento AJUSTE) ────────────────────────

// Lectura ligera del stock por almacén de un producto (sin el resto del detalle),
// para pre-cargar el modal de ajuste con el stock real de cada almacén.
export async function obtenerStockPorAlmacen(
  producto_id: string,
): Promise<{ almacen_id: string; cantidad: number }[]> {
  const session = await getPortalSession()
  if (!session) return []

  const db = createAdminClient()
  const { data } = await db.from('stock_almacenes')
    .select('almacen_id, cantidad')
    .eq('client_id', session.client_id)
    .eq('producto_id', producto_id)

  return ((data ?? []) as { almacen_id: string; cantidad: number }[])
    .map(s => ({ almacen_id: s.almacen_id, cantidad: Number(s.cantidad) }))
}

// ── Stock mínimo por almacén (mig. 153) ────────────────────────────────────────

/**
 * Fija —o borra— el mínimo de un producto en UN almacén.
 *
 * `minimo` a `null` no es «mínimo cero»: es «este almacén vuelve a regirse por el
 * global de la ficha». Por eso se borra la fila en vez de guardar 0, que sí sería
 * un umbral (y uno que no avisa nunca).
 */
export async function guardarStockMinimoAlmacen(
  producto_id: string,
  almacen_id:  string,
  minimo:      number | null,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  // `inventario` a secas: el mínimo por almacén es del módulo de existencias, no
  // del catálogo compartido con Servicios.
  if (!(await puedeEditarModulo('inventario')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!almacen_id) return { ok: false, error: 'Selecciona un almacén.' }
  if (minimo != null && (!Number.isFinite(minimo) || minimo < 0))
    return { ok: false, error: 'El mínimo no puede ser negativo.' }

  const db = createAdminClient()

  // El almacén tiene que ser suyo: sin esta comprobación se podría configurar un
  // almacén de otro tenant, que es justo lo que el client_id no puede impedir solo.
  const { data: alm } = await db.from('almacenes')
    .select('almacen_id').eq('almacen_id', almacen_id).eq('client_id', session.client_id).maybeSingle()
  if (!alm) return { ok: false, error: 'Almacén no encontrado.' }

  if (minimo == null) {
    const { error } = await db.from('producto_almacen_config').delete()
      .eq('client_id', session.client_id)
      .eq('producto_id', producto_id).eq('almacen_id', almacen_id)
    if (error) return { ok: false, error: 'No se pudo quitar el mínimo.' }
  } else {
    const { error } = await db.from('producto_almacen_config').upsert({
      client_id: session.client_id,
      producto_id, almacen_id,
      stock_minimo: minimo,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'producto_id,almacen_id' })
    if (error) return { ok: false, error: 'No se pudo guardar el mínimo.' }
  }

  revalidatePath('/portal/productos')
  revalidatePath('/portal/almacenes')
  revalidatePath('/portal/inventario')
  return { ok: true }
}

export async function ajustarStock(
  producto_id: string,
  almacen_id:  string,
  cantidad:    number,
  motivo:      string,
): Promise<{ ok: boolean; error?: string; stock_nuevo?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  // `inventario` a secas, NO el gate compartido: mover existencias es justo lo que
  // la pieza Servicios no incluye. Con el gate compartido, un cliente de Servicios
  // podría ajustar stock desde la acción aunque la UI no le enseñe el botón — y la
  // UI oculta no es control de acceso.
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  if (!almacen_id) return { ok: false, error: 'Selecciona un almacén.' }
  if (isNaN(cantidad) || cantidad === 0)
    return { ok: false, error: 'La cantidad debe ser un número distinto de cero.' }
  if (!motivo?.trim())
    return { ok: false, error: 'El motivo del ajuste es obligatorio.' }

  const db = createAdminClient()

  const { data: prod } = await db.from('products')
    .select('tipo').eq('producto_id', producto_id).eq('client_id', session.client_id).single()
  if (!prod)                    return { ok: false, error: 'Producto no encontrado.' }
  if (prod.tipo === 'SERVICIO') return { ok: false, error: 'Los servicios no tienen stock.' }

  const { data: alm } = await db.from('almacenes')
    .select('empresa_id, nombre').eq('almacen_id', almacen_id).eq('client_id', session.client_id).single()
  if (!alm) return { ok: false, error: 'Almacén no válido.' }

  const disp = await stockEnAlmacen(db, session.client_id, producto_id, almacen_id)
  if (disp + cantidad < 0)
    return { ok: false, error: `El ajuste dejaría el stock negativo. Disponible en ${alm.nombre}: ${disp}.` }

  let stock_nuevo = 0
  try {
    const res = await aplicarMovimiento(db, {
      client_id:  session.client_id,
      empresa_id: alm.empresa_id,
      fecha:      new Date().toISOString().split('T')[0],
      tipo:       'AJUSTE',
      producto_id,
      almacen_id,
      cantidad,                 // delta con signo
      motivo:     motivo.trim(),
      // El modal de ajuste es «añadir/quitar/fijar», siempre un ajuste de conteo o
      // corrección: entra tipificado como CONTEO y el texto libre queda de detalle.
      motivo_tipo: 'CONTEO',
      origen:     'MANUAL',
    })
    stock_nuevo = res.stock_global
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error al ajustar el stock.' }
  }

  revalidatePath('/portal/productos')
  revalidatePath(`/portal/productos/${producto_id}`)
  revalidatePath('/portal/inventario')
  return { ok: true, stock_nuevo }
}

// ── Guardar categoría ─────────────────────────────────────────────────────────

export async function guardarCategoria(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; categoria_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(MODULOS_CATALOGO))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const nombre = ((formData.get('nombre') as string) ?? '').trim()
  if (!nombre) return { ok: false, error: 'El nombre de la categoría es obligatorio.' }

  const db = createAdminClient()
  const categoria_id_form = ((formData.get('categoria_id') as string) ?? '').trim()

  // Guardia de servidor: la columna tiene CHECK y un valor inventado tumbaría el
  // guardado entero en vez de ignorarse.
  const tipoRaw = ((formData.get('tipo') as string) ?? '').trim()
  const tipo: TipoCategoria =
    tipoRaw === 'PRODUCTO' || tipoRaw === 'SERVICIO' || tipoRaw === 'AMBAS' ? tipoRaw : 'AMBAS'

  if (!categoria_id_form) {
    const categoria_id = generarCategoriaProductoId()
    const { error } = await db.from('product_categories').insert({
      categoria_id,
      client_id:   session.client_id,
      nombre,
      descripcion: ((formData.get('descripcion') as string) ?? '').trim() || null,
      tipo,
      estado:      'ACTIVO',
      created_at:  new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    })
    if (error) return { ok: false, error: `Error al crear: ${error.message}` }
    revalidatePath('/portal/productos')
    revalidatePath('/portal/servicios')
    return { ok: true, categoria_id }
  }

  const { error } = await db
    .from('product_categories')
    .update({
      nombre,
      descripcion: ((formData.get('descripcion') as string) ?? '').trim() || null,
      tipo,
      updated_at:  new Date().toISOString(),
    })
    .eq('categoria_id', categoria_id_form)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al actualizar.' }
  revalidatePath('/portal/productos')
  revalidatePath('/portal/servicios')
  return { ok: true, categoria_id: categoria_id_form }
}

// ── Archivar / restaurar categoría ───────────────────────────────────────────

export async function archivarCategoria(
  categoria_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(MODULOS_CATALOGO))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db
    .from('product_categories')
    .update({ estado: 'INACTIVO', updated_at: new Date().toISOString() })
    .eq('categoria_id', categoria_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al archivar.' }
  revalidarFicha()   // una categoría puede ser de productos, de servicios o de ambas
  return { ok: true }
}

export async function restaurarCategoria(
  categoria_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(MODULOS_CATALOGO))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db
    .from('product_categories')
    .update({ estado: 'ACTIVO', updated_at: new Date().toISOString() })
    .eq('categoria_id', categoria_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al restaurar.' }
  revalidarFicha()   // una categoría puede ser de productos, de servicios o de ambas
  return { ok: true }
}

// ── Detalle de producto ───────────────────────────────────────────────────────

export interface MovimientoProducto {
  movimiento_id:      string
  fecha:              string
  tipo:               TipoMovimiento
  almacen_id:         string
  almacen_destino_id: string | null
  cantidad:           number
  motivo:             string | null
  origen:             'MANUAL' | 'COMPRA' | 'VENTA'
}

export interface HistorialPrecio {
  historial_id: string
  moneda:       string
  precio:       number | null
  costo:        number | null
  created_at:   string
}

export interface ProductoDetalleData {
  producto:          Producto
  categoria:         Categoria | null
  proveedor:         { tercero_id: string; nombre: string } | null
  monedas:           string[]
  categorias:        Categoria[]
  proveedores:       { tercero_id: string; nombre: string; empresa_id: string }[]
  /** Empresas visibles para este usuario — agrupa el selector de proveedor cuando
   *  hay más de una (ver ProductosPageData.empresas). */
  empresas:          { empresa_id: string; nombre: string }[]
  almacenes:         { almacen_id: string; nombre: string; empresa_id: string }[]
  /** `minimo` es el de ESE almacén (mig. 153); `null` = se rige por el global. */
  stock_por_almacen: { almacen_id: string; nombre: string; cantidad: number; minimo: number | null }[]
  movimientos:       MovimientoProducto[]
  almacen_nombres:   Record<string, string>
  historialPrecios:  HistorialPrecio[]
  /** Sin `inventario` la ficha no enseña existencias ni movimientos (ver
   *  `ProductosPageData.tieneInventario`). */
  tieneInventario:   boolean
  etiquetaServicio:  string
  // ── Solo servicios ──
  /**
   * Quién lo tiene contratado y a qué precio PACTADO. Es la pantalla sin la cual subir
   * una tarifa se decide a ciegas — y deja a la vista, sin explicarlo, por qué el precio
   * del catálogo no repisa los acuerdos vivos: se ven los diez precios distintos que
   * tiene el mismo servicio.
   */
  contratos:         ContratoDeServicio[]
  /** Si Citas está contratado y hay vínculo (mig. 119). Solo lectura y solo informativo. */
  agenda:            { servicio_id: string; nombre: string; duracion_minutos: number } | null
}

/** Un acuerdo que incluye este servicio, con su precio pactado. */
export interface ContratoDeServicio {
  suscripcion_id:  string
  cliente_nombre:  string
  moneda:          string
  /** El precio PACTADO de este servicio en ese acuerdo, por mes. */
  precio_mensual:  number
  periodicidad:    string
  fecha_inicio:    string
  /** ACTIVA | PAUSADA | VENCIDA | CANCELADA, ya derivado. */
  estado:          string
  /** Lo que aporta al mes, con su descuento aplicado. */
  equivalente_mes: number
}

export async function obtenerProductoDetalle(
  producto_id: string,
): Promise<ProductoDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  // Mismo acotado por rol que en obtenerProductos: proveedores y almacenes solo de
  // las empresas que este usuario puede ver, no de todo el client_id.
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [prodRes, catRes, provRes, monRes, almRes, stkRes, cfgRes, movRes, histRes] = await Promise.all([
    db.from('products')
      .select('*')
      .eq('producto_id', producto_id)
      .eq('client_id', session.client_id)
      .single(),
    db.from('product_categories')
      .select('*')
      .eq('client_id', session.client_id)
      .order('nombre'),
    db.from('third_parties')
      .select('tercero_id, nombre, empresa_id')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .in('tipo', ['PROVEEDOR', 'AMBOS'])
      .eq('activo', true)
      .order('nombre'),
    db.from('monedas')
      .select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('codigo'),
    // TODOS, incluidos los archivados: si no, la ficha pintaba el código crudo
    // («ALM-5EED03») en cuanto un almacén con existencias se archivaba. Los
    // archivados se marcan al resolver el nombre y no entran en los selectores.
    db.from('almacenes')
      .select('almacen_id, nombre, empresa_id, activo')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('nombre'),
    db.from('stock_almacenes')
      .select('almacen_id, cantidad')
      .eq('client_id', session.client_id)
      .eq('producto_id', producto_id),
    db.from('producto_almacen_config')
      .select('almacen_id, stock_minimo')
      .eq('client_id', session.client_id)
      .eq('producto_id', producto_id),
    db.from('movimientos_inventario')
      .select('movimiento_id, fecha, tipo, almacen_id, almacen_destino_id, cantidad, motivo, origen')
      .eq('client_id', session.client_id)
      .eq('producto_id', producto_id)
      .order('created_at', { ascending: false })
      .limit(100),
    db.from('producto_precios_historial')
      .select('historial_id, moneda, precio, costo, created_at')
      .eq('client_id', session.client_id)
      .eq('producto_id', producto_id)
      .order('created_at', { ascending: false }),
  ])

  if (!prodRes.data) return null

  const raw = prodRes.data as Record<string, unknown>
  const producto: Producto = {
    ...raw,
    precios:      (typeof raw.precios === 'object' && raw.precios !== null) ? raw.precios as Record<string, number> : {},
    costos:       (typeof raw.costos  === 'object' && raw.costos  !== null) ? raw.costos  as Record<string, number> : {},
    stock_actual: Number(raw.stock_actual) || 0,
    stock_minimo: Number(raw.stock_minimo) || 0,
  } as Producto

  // Las categorías del desplegable son las de SU tipo (mig. 122), pero la que ya tiene
  // asignada se conserva aunque no encaje: si no, editar el precio de una ficha vieja
  // le cambiaría la categoría de rebote sin que nadie lo pidiera.
  const todasCat    = (catRes.data ?? []) as Categoria[]
  const categorias  = todasCat.filter(c =>
    c.tipo === 'AMBAS' || c.tipo === producto.tipo || c.categoria_id === producto.categoria_id)
  const proveedores = (provRes.data ?? []) as ProductoDetalleData['proveedores']
  const monedas     = (monRes.data  ?? []).map((m: { codigo: string }) => m.codigo)

  const categoria = producto.categoria_id
    ? (todasCat.find(c => c.categoria_id === producto.categoria_id) ?? null)
    : null

  const proveedor = producto.proveedor_id
    ? (proveedores.find(p => p.tercero_id === producto.proveedor_id) ?? null)
    : null

  const todosAlmacenes = (almRes.data ?? []) as { almacen_id: string; nombre: string; empresa_id: string; activo: boolean }[]
  const almacen_nombres: Record<string, string> = {}
  for (const a of todosAlmacenes) almacen_nombres[a.almacen_id] = a.activo ? a.nombre : `${a.nombre} (archivado)`
  // Los selectores (ajustar stock, mover) solo ofrecen los vivos.
  const almacenes = todosAlmacenes.filter(a => a.activo)
    .map(({ almacen_id, nombre, empresa_id }) => ({ almacen_id, nombre, empresa_id }))

  const minimoDe = new Map(
    ((cfgRes.data ?? []) as { almacen_id: string; stock_minimo: number | null }[])
      .filter(c => c.stock_minimo != null)
      .map(c => [c.almacen_id, Number(c.stock_minimo)]),
  )

  // Un almacén con mínimo configurado se enseña AUNQUE esté a cero: es justo el
  // momento en que el mínimo importa, y filtrarlo sería esconder el problema.
  const cantidadDe = new Map(
    ((stkRes.data ?? []) as { almacen_id: string; cantidad: number }[])
      .map(s => [s.almacen_id, Number(s.cantidad)]),
  )
  const stock_por_almacen = [...new Set([...cantidadDe.keys(), ...minimoDe.keys()])]
    .map(almacen_id => ({
      almacen_id,
      nombre:   almacen_nombres[almacen_id] ?? almacen_id,
      cantidad: cantidadDe.get(almacen_id) ?? 0,
      minimo:   minimoDe.get(almacen_id) ?? null,
    }))
    .filter(s => Math.abs(s.cantidad) > 0.0005 || s.minimo != null)
    .sort((a, b) => b.cantidad - a.cantidad)

  // ── Quién lo tiene contratado (solo servicios) ──
  const contratos: ContratoDeServicio[] = []
  let agenda: ProductoDetalleData['agenda'] = null
  if (producto.tipo === 'SERVICIO') {
    const { data: lins } = await db.from('suscripcion_lineas')
      .select('suscripcion_id, precio_mensual, descuento_modo, descuento_valor')
      .eq('client_id', session.client_id).eq('producto_id', producto_id)
    const filas = (lins ?? []) as {
      suscripcion_id: string; precio_mensual: number
      descuento_modo: string; descuento_valor: number
    }[]
    if (filas.length) {
      const [{ data: subs }, { data: terc }] = await Promise.all([
        db.from('suscripciones')
          .select('suscripcion_id, cliente_id, moneda, periodicidad, fecha_inicio, fecha_fin, renovacion_automatica, estado')
          .eq('client_id', session.client_id).in('suscripcion_id', filas.map(f => f.suscripcion_id)),
        db.from('third_parties').select('tercero_id, nombre').eq('client_id', session.client_id),
      ])
      const nombreDe = new Map(((terc ?? []) as { tercero_id: string; nombre: string }[])
        .map(t => [t.tercero_id, t.nombre]))
      const hoy = new Date().toISOString().split('T')[0]
      const subDe = new Map(((subs ?? []) as Record<string, unknown>[]).map(x => [x.suscripcion_id as string, x]))
      for (const f of filas) {
        const sub = subDe.get(f.suscripcion_id)
        if (!sub) continue
        // El importe con SU descuento: un anual rebajado no aporta el precio de lista.
        const c = calcularCobro(
          Number(f.precio_mensual) || 0,
          sub.periodicidad as PeriodicidadSub,
          (f.descuento_modo === 'MONTO_FIJO' ? 'MONTO_FIJO' : 'PORCENTAJE') as DescuentoModo,
          Number(f.descuento_valor) || 0,
        )
        contratos.push({
          suscripcion_id:  f.suscripcion_id,
          cliente_nombre:  nombreDe.get(sub.cliente_id as string) ?? '—',
          moneda:          sub.moneda as string,
          precio_mensual:  Number(f.precio_mensual) || 0,
          periodicidad:    sub.periodicidad as string,
          fecha_inicio:    sub.fecha_inicio as string,
          estado:          estadoEfectivo({
            estado:                sub.estado as EstadoSub,
            fecha_fin:             (sub.fecha_fin as string | null) ?? null,
            renovacion_automatica: Boolean(sub.renovacion_automatica),
          }, hoy),
          equivalente_mes: c.equivalenteMensual,
        })
      }
      contratos.sort((a, b) => a.cliente_nombre.localeCompare(b.cliente_nombre))
    }

    // El puente con Citas es BLANDO y en una dirección (mig. 119): solo se enseña si el
    // módulo está contratado y hay vínculo. Sin `agenda` no se pinta nada.
    if (tieneModulo((await db.from('clients').select('modulos_activos')
      .eq('client_id', session.client_id).maybeSingle()).data?.modulos_activos, 'agenda')) {
      const { data: srv } = await db.from('servicios')
        .select('servicio_id, nombre, duracion_minutos')
        .eq('client_id', session.client_id).eq('producto_id', producto_id).maybeSingle()
      if (srv) agenda = {
        servicio_id: srv.servicio_id as string,
        nombre: srv.nombre as string,
        duracion_minutos: Number(srv.duracion_minutos) || 0,
      }
    }
  }

  const movimientos = ((movRes.data ?? []) as Record<string, unknown>[]).map(m => ({
    movimiento_id:      m.movimiento_id as string,
    fecha:              m.fecha as string,
    tipo:               m.tipo as MovimientoProducto['tipo'],
    almacen_id:         m.almacen_id as string,
    almacen_destino_id: (m.almacen_destino_id as string) ?? null,
    cantidad:           Number(m.cantidad),
    motivo:             (m.motivo as string) ?? null,
    origen:             m.origen as MovimientoProducto['origen'],
  })) as MovimientoProducto[]

  const historialPrecios = ((histRes.data ?? []) as Record<string, unknown>[]).map(h => ({
    historial_id: h.historial_id as string,
    moneda:       h.moneda as string,
    precio:       h.precio != null ? Number(h.precio) : null,
    costo:        h.costo != null ? Number(h.costo) : null,
    created_at:   h.created_at as string,
  }))

  return {
    producto,
    categoria,
    proveedor,
    monedas: monedas.length ? monedas : ['USD'],
    categorias,
    proveedores,
    empresas: empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    almacenes,
    stock_por_almacen,
    movimientos,
    almacen_nombres,
    historialPrecios,
    contratos,
    agenda,
    ...(await contextoCatalogo(session.client_id)),
  }
}
