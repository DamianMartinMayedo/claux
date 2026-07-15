'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { aplicarMovimiento, stockEnAlmacen, type TipoMovimiento } from './_inventario-helpers'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type TipoProducto = 'PRODUCTO' | 'SERVICIO'

export interface Categoria {
  categoria_id: string
  client_id:    string
  nombre:       string
  descripcion:  string | null
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
  categorias:  Categoria[]
  proveedores: { tercero_id: string; nombre: string }[]
  monedas:     string[]   // códigos de monedas activas del cliente, ej: ['USD','CUP']
  almacenes:   { almacen_id: string; nombre: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generarProductoId(tipo: TipoProducto): string {
  const pfx = tipo === 'SERVICIO' ? 'SRV' : 'PRD'
  return `${pfx}-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

function generarCategoriaId(): string {
  return `CAT-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

async function generarCodigo(
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
    const last  = (data[0].codigo as string).split('-')
    const n     = parseInt(last[last.length - 1]) || 0
    num         = n + 1
  }
  return `${pfx}-${String(num).padStart(4, '0')}`
}

// ── Obtener ───────────────────────────────────────────────────────────────────

export async function obtenerProductos(): Promise<ProductosPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const [prodRes, catRes, provRes, monRes, almRes] = await Promise.all([
    db.from('products')
      .select('*')
      .eq('client_id', session.client_id)
      .order('nombre'),
    db.from('product_categories')
      .select('*')
      .eq('client_id', session.client_id)
      .order('nombre'),
    db.from('third_parties')
      .select('tercero_id, nombre')
      .eq('client_id', session.client_id)
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
      .eq('activo', true)
      .order('nombre'),
  ])

  const productos = (prodRes.data ?? []).map((p: Record<string, unknown>) => ({
    ...p,
    precios:      (typeof p.precios === 'object' && p.precios !== null) ? p.precios : {},
    costos:       (typeof p.costos  === 'object' && p.costos  !== null) ? p.costos  : {},
    stock_actual: Number(p.stock_actual) || 0,
    stock_minimo: Number(p.stock_minimo) || 0,
  })) as Producto[]

  const monedas = (monRes.data ?? []).map((m: { codigo: string }) => m.codigo)

  return {
    productos,
    categorias:  (catRes.data  ?? []) as Categoria[],
    proveedores: (provRes.data ?? []) as { tercero_id: string; nombre: string }[],
    monedas:     monedas.length ? monedas : ['USD'],   // fallback si no hay monedas configuradas
    almacenes:   (almRes.data  ?? []) as { almacen_id: string; nombre: string }[],
  }
}

// ── Guardar producto ──────────────────────────────────────────────────────────

export async function guardarProducto(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; producto_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const nombre = ((formData.get('nombre') as string) ?? '').trim()
  if (!nombre) return { ok: false, error: 'El nombre es obligatorio.' }

  const tipo = ((formData.get('tipo') as string) ?? '').trim() as TipoProducto
  if (!['PRODUCTO', 'SERVICIO'].includes(tipo))
    return { ok: false, error: 'Tipo inválido.' }

  const unidad = ((formData.get('unidad') as string) ?? '').trim()
  if (!unidad) return { ok: false, error: 'La unidad es obligatoria.' }

  const db = createAdminClient()

  let precios: Record<string, number> = {}
  let costos:  Record<string, number> = {}
  try { precios = JSON.parse((formData.get('precios') as string) ?? '{}') } catch { /* ok */ }
  try { costos  = JSON.parse((formData.get('costos')  as string) ?? '{}') } catch { /* ok */ }

  const producto_id_form = ((formData.get('producto_id') as string) ?? '').trim()

  const campos = {
    nombre,
    tipo,
    unidad,
    codigo_proveedor: ((formData.get('codigo_proveedor') as string) ?? '').trim() || null,
    descripcion:      ((formData.get('descripcion')      as string) ?? '').trim() || null,
    categoria_id:     ((formData.get('categoria_id')     as string) ?? '').trim() || null,
    proveedor_id:     ((formData.get('proveedor_id')     as string) ?? '').trim() || null,
    precios,
    costos,
    stock_minimo:     tipo === 'SERVICIO'
      ? 0
      : (parseFloat((formData.get('stock_minimo') as string) ?? '0') || 0),
    updated_at:       new Date().toISOString(),
  }

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
    const codigo      = await generarCodigo(db, session.client_id, tipo)

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
    revalidatePath('/portal/productos')
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
  revalidatePath('/portal/productos')
  return { ok: true, producto_id: producto_id_form }
}

// ── Archivar / restaurar producto ─────────────────────────────────────────────

export async function archivarProducto(
  producto_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { error } = await db
    .from('products')
    .update({ estado: 'INACTIVO', updated_at: new Date().toISOString() })
    .eq('producto_id', producto_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al archivar.' }
  revalidatePath('/portal/productos')
  return { ok: true }
}

export async function restaurarProducto(
  producto_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { error } = await db
    .from('products')
    .update({ estado: 'ACTIVO', updated_at: new Date().toISOString() })
    .eq('producto_id', producto_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al restaurar.' }
  revalidatePath('/portal/productos')
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
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const { data: prod } = await db
    .from('products')
    .select('estado')
    .eq('producto_id', producto_id)
    .eq('client_id', session.client_id)
    .single()
  if (!prod)                     return { ok: false, error: 'Producto no encontrado.' }
  if (prod.estado !== 'INACTIVO') return { ok: false, error: 'Archiva el producto antes de eliminarlo.' }

  const dependencias: { tabla: string; etiqueta: string }[] = [
    { tabla: 'documento_lineas',       etiqueta: 'ventas u ofertas' },
    { tabla: 'compra_lineas',          etiqueta: 'compras' },
    { tabla: 'movimientos_inventario', etiqueta: 'movimientos de inventario' },
    { tabla: 'catalogo_items',         etiqueta: 'tu catálogo público' },
    { tabla: 'caja_ticket_lineas',     etiqueta: 'tickets de caja' },
  ]
  for (const d of dependencias) {
    const { count } = await db.from(d.tabla).select('*', { count: 'exact', head: true }).eq('producto_id', producto_id)
    if ((count ?? 0) > 0) {
      return { ok: false, error: `No se puede eliminar: tiene ${d.etiqueta} asociadas. Se mantiene archivado.` }
    }
  }

  await db.from('producto_precios_historial').delete().eq('producto_id', producto_id)
  await db.from('stock_almacenes').delete().eq('producto_id', producto_id)
  const { error } = await db
    .from('products')
    .delete()
    .eq('producto_id', producto_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'Error al eliminar.' }

  revalidatePath('/portal/productos')
  return { ok: true }
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

export async function ajustarStock(
  producto_id: string,
  almacen_id:  string,
  cantidad:    number,
  motivo:      string,
): Promise<{ ok: boolean; error?: string; stock_nuevo?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

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

  const disp = await stockEnAlmacen(db, producto_id, almacen_id)
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
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const nombre = ((formData.get('nombre') as string) ?? '').trim()
  if (!nombre) return { ok: false, error: 'El nombre de la categoría es obligatorio.' }

  const db = createAdminClient()
  const categoria_id_form = ((formData.get('categoria_id') as string) ?? '').trim()

  if (!categoria_id_form) {
    const categoria_id = generarCategoriaId()
    const { error } = await db.from('product_categories').insert({
      categoria_id,
      client_id:   session.client_id,
      nombre,
      descripcion: ((formData.get('descripcion') as string) ?? '').trim() || null,
      estado:      'ACTIVO',
      created_at:  new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    })
    if (error) return { ok: false, error: `Error al crear: ${error.message}` }
    revalidatePath('/portal/productos')
    return { ok: true, categoria_id }
  }

  const { error } = await db
    .from('product_categories')
    .update({
      nombre,
      descripcion: ((formData.get('descripcion') as string) ?? '').trim() || null,
      updated_at:  new Date().toISOString(),
    })
    .eq('categoria_id', categoria_id_form)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al actualizar.' }
  revalidatePath('/portal/productos')
  return { ok: true, categoria_id: categoria_id_form }
}

// ── Archivar / restaurar categoría ───────────────────────────────────────────

export async function archivarCategoria(
  categoria_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { error } = await db
    .from('product_categories')
    .update({ estado: 'INACTIVO', updated_at: new Date().toISOString() })
    .eq('categoria_id', categoria_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al archivar.' }
  revalidatePath('/portal/productos')
  return { ok: true }
}

export async function restaurarCategoria(
  categoria_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { error } = await db
    .from('product_categories')
    .update({ estado: 'ACTIVO', updated_at: new Date().toISOString() })
    .eq('categoria_id', categoria_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al restaurar.' }
  revalidatePath('/portal/productos')
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
  proveedores:       { tercero_id: string; nombre: string }[]
  almacenes:         { almacen_id: string; nombre: string; empresa_id: string }[]
  stock_por_almacen: { almacen_id: string; nombre: string; cantidad: number }[]
  movimientos:       MovimientoProducto[]
  almacen_nombres:   Record<string, string>
  historialPrecios:  HistorialPrecio[]
}

export async function obtenerProductoDetalle(
  producto_id: string,
): Promise<ProductoDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const [prodRes, catRes, provRes, monRes, almRes, stkRes, movRes, histRes] = await Promise.all([
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
      .select('tercero_id, nombre')
      .eq('client_id', session.client_id)
      .in('tipo', ['PROVEEDOR', 'AMBOS'])
      .eq('activo', true)
      .order('nombre'),
    db.from('monedas')
      .select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('codigo'),
    db.from('almacenes')
      .select('almacen_id, nombre, empresa_id')
      .eq('client_id', session.client_id)
      .eq('activo', true)
      .order('nombre'),
    db.from('stock_almacenes')
      .select('almacen_id, cantidad')
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

  const categorias  = (catRes.data  ?? []) as Categoria[]
  const proveedores = (provRes.data ?? []) as { tercero_id: string; nombre: string }[]
  const monedas     = (monRes.data  ?? []).map((m: { codigo: string }) => m.codigo)

  const categoria = producto.categoria_id
    ? (categorias.find(c => c.categoria_id === producto.categoria_id) ?? null)
    : null

  const proveedor = producto.proveedor_id
    ? (proveedores.find(p => p.tercero_id === producto.proveedor_id) ?? null)
    : null

  const almacenes = (almRes.data ?? []) as { almacen_id: string; nombre: string; empresa_id: string }[]
  const almacen_nombres: Record<string, string> = {}
  for (const a of almacenes) almacen_nombres[a.almacen_id] = a.nombre

  const stock_por_almacen = ((stkRes.data ?? []) as { almacen_id: string; cantidad: number }[])
    .map(s => ({
      almacen_id: s.almacen_id,
      nombre:     almacen_nombres[s.almacen_id] ?? s.almacen_id,
      cantidad:   Number(s.cantidad),
    }))
    .filter(s => Math.abs(s.cantidad) > 0.0005)
    .sort((a, b) => b.cantidad - a.cantidad)

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
    almacenes,
    stock_por_almacen,
    movimientos,
    almacen_nombres,
    historialPrecios,
  }
}
