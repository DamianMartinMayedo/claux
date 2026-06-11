'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'

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
  precios:          Record<string, number>  // { USD: 25.00, VES: 150000 }
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
  monedas:     string[]   // códigos de monedas activas del cliente, ej: ['USD','VES']
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

  const [prodRes, catRes, provRes, monRes] = await Promise.all([
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

  const { error } = await db
    .from('products')
    .update(campos)
    .eq('producto_id', producto_id_form)
    .eq('client_id', session.client_id)

  if (error) {
    console.error('[productos] update error:', error)
    return { ok: false, error: 'Error al actualizar.' }
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

// ── Ajuste de stock ───────────────────────────────────────────────────────────

export async function ajustarStock(
  producto_id: string,
  cantidad:    number,
  motivo:      string,
): Promise<{ ok: boolean; error?: string; stock_nuevo?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  if (isNaN(cantidad) || cantidad === 0)
    return { ok: false, error: 'La cantidad debe ser un número distinto de cero.' }
  if (!motivo?.trim())
    return { ok: false, error: 'El motivo del ajuste es obligatorio.' }

  const db = createAdminClient()

  const { data: prod } = await db
    .from('products')
    .select('stock_actual, tipo')
    .eq('producto_id', producto_id)
    .eq('client_id', session.client_id)
    .single()

  if (!prod)                  return { ok: false, error: 'Producto no encontrado.' }
  if (prod.tipo === 'SERVICIO') return { ok: false, error: 'Los servicios no tienen stock.' }

  const stock_anterior = Number(prod.stock_actual) || 0
  const stock_nuevo    = stock_anterior + cantidad

  if (stock_nuevo < 0)
    return { ok: false, error: `Stock insuficiente. Actual: ${stock_anterior}.` }

  const { error } = await db
    .from('products')
    .update({ stock_actual: stock_nuevo, updated_at: new Date().toISOString() })
    .eq('producto_id', producto_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al ajustar stock.' }
  revalidatePath('/portal/productos')
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

export interface ProductoDetalleData {
  producto:    Producto
  categoria:   Categoria | null
  proveedor:   { tercero_id: string; nombre: string } | null
  monedas:     string[]
  categorias:  Categoria[]
  proveedores: { tercero_id: string; nombre: string }[]
}

export async function obtenerProductoDetalle(
  producto_id: string,
): Promise<ProductoDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const [prodRes, catRes, provRes, monRes] = await Promise.all([
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

  return {
    producto,
    categoria,
    proveedor,
    monedas: monedas.length ? monedas : ['USD'],
    categorias,
    proveedores,
  }
}
