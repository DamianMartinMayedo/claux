'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { traducirErrorInventario } from './_inventario-helpers'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type EstadoCompra = 'BORRADOR' | 'CONFIRMADA' | 'ANULADA'

export interface Compra {
  compra_id:    string
  numero:       string
  client_id:    string
  empresa_id:   string
  proveedor_id: string | null
  almacen_id:   string
  fecha:        string
  moneda:       string
  estado:       EstadoCompra
  total:        number
  notas:        string | null
  gasto_id:     string | null
  created_at:   string
  updated_at:   string
}

export interface CompraLinea {
  linea_id:       number
  compra_id:      string
  orden:          number
  producto_id:    string | null
  descripcion:    string
  cantidad:       number
  costo_unitario: number
  total:          number
}

export interface ProductoCompra {
  producto_id: string
  codigo:      string
  nombre:      string
  unidad:      string
  costos:      Record<string, number>
}

export interface ComprasPageData {
  compras:         Compra[]
  proveedores:     { tercero_id: string; nombre: string; empresa_id: string; moneda_defecto: string | null }[]
  almacenes:       { almacen_id: string; nombre: string; empresa_id: string }[]
  productos:       ProductoCompra[]
  monedas:         string[]
  empresa_nombres: Record<string, string>
  proveedor_nombres: Record<string, string>
  almacen_nombres: Record<string, string>
}

export interface CompraDetalleData {
  compra:        Compra
  lineas:        CompraLinea[]
  proveedor:     { tercero_id: string; nombre: string } | null
  almacen:       { almacen_id: string; nombre: string } | null
  empresa_nombre: string
  // datos para edición de borrador
  proveedores:   ComprasPageData['proveedores']
  almacenes:     ComprasPageData['almacenes']
  productos:     ProductoCompra[]
  monedas:       string[]
  // pago vinculado (si está confirmada)
  pagado:        number
  saldo:         number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generarCompraId(): string {
  return `CMP-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
function hoy(): string {
  return new Date().toISOString().split('T')[0]
}

// Reserva el siguiente correlativo de compra para (empresa, año) → COM-AAAA-####
async function siguienteNumeroCompra(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, client_id: string, empresa_id: string, anio: number,
): Promise<string> {
  const { data: existente } = await db.from('consecutivos_compra')
    .select('ultimo_numero')
    .eq('client_id', client_id).eq('empresa_id', empresa_id).eq('anio', anio)
    .maybeSingle()
  const nuevo = (existente?.ultimo_numero ?? 0) + 1
  const { error } = await db.from('consecutivos_compra').upsert({
    client_id, empresa_id, anio, ultimo_numero: nuevo, updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id,empresa_id,anio' })
  if (error) throw new Error(`No se pudo reservar consecutivo de compra: ${error.message}`)
  return `COM-${anio}-${String(nuevo).padStart(4, '0')}`
}

interface LineaInput {
  producto_id:    string | null
  descripcion:    string
  cantidad:       number
  costo_unitario: number
}

function parseLineas(raw: FormDataEntryValue | null): LineaInput[] {
  if (!raw || typeof raw !== 'string') return []
  try {
    const arr = JSON.parse(raw) as LineaInput[]
    return arr
      .map(l => ({
        producto_id:    l.producto_id || null,
        descripcion:    (l.descripcion ?? '').trim(),
        cantidad:       Number(l.cantidad) || 0,
        costo_unitario: Number(l.costo_unitario) || 0,
      }))
      .filter(l => l.descripcion && l.cantidad > 0)
  } catch { return [] }
}

// ── Obtener listado + datos de formulario ──────────────────────────────────────

export async function obtenerCompras(): Promise<ComprasPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [compRes, provRes, almRes, prodRes, monRes] = await Promise.all([
    db.from('compras').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('created_at', { ascending: false }),
    db.from('third_parties')
      .select('tercero_id, nombre, empresa_id, moneda_defecto')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .in('tipo', ['PROVEEDOR', 'AMBOS'])
      .eq('activo', true)
      .order('nombre'),
    db.from('almacenes')
      .select('almacen_id, nombre, empresa_id')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .eq('activo', true)
      .order('nombre'),
    db.from('products')
      .select('producto_id, codigo, nombre, unidad, costos')
      .eq('client_id', session.client_id)
      .eq('estado', 'ACTIVO')
      .order('nombre'),
    db.from('monedas')
      .select('codigo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
  ])

  const proveedores = (provRes.data ?? []) as ComprasPageData['proveedores']
  const almacenes   = (almRes.data  ?? []) as ComprasPageData['almacenes']
  const productos   = ((prodRes.data ?? []) as Record<string, unknown>[]).map(p => ({
    producto_id: p.producto_id as string,
    codigo:      p.codigo as string,
    nombre:      p.nombre as string,
    unidad:      p.unidad as string,
    costos:      (typeof p.costos === 'object' && p.costos !== null) ? p.costos as Record<string, number> : {},
  }))
  const monedas = (monRes.data ?? []).map((m: { codigo: string }) => m.codigo)

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre
  const proveedor_nombres: Record<string, string> = {}
  for (const p of proveedores) proveedor_nombres[p.tercero_id] = p.nombre
  const almacen_nombres: Record<string, string> = {}
  for (const a of almacenes) almacen_nombres[a.almacen_id] = a.nombre

  return {
    compras: (compRes.data ?? []) as Compra[],
    proveedores, almacenes, productos,
    monedas: monedas.length ? monedas : ['USD'],
    empresa_nombres, proveedor_nombres, almacen_nombres,
  }
}

// ── Detalle ─────────────────────────────────────────────────────────────────────

export async function obtenerCompraDetalle(compra_id: string): Promise<CompraDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const page = await obtenerCompras()
  if (!page) return null

  const { data: compra } = await db.from('compras').select('*')
    .eq('compra_id', compra_id).eq('client_id', session.client_id).single()
  if (!compra) return null

  const { data: lineasRaw } = await db.from('compra_lineas').select('*')
    .eq('compra_id', compra_id).eq('client_id', session.client_id).order('orden')
  const lineas = (lineasRaw ?? []).map((l: Record<string, unknown>) => ({
    linea_id:       Number(l.linea_id),
    compra_id:      l.compra_id as string,
    orden:          Number(l.orden),
    producto_id:    (l.producto_id as string) ?? null,
    descripcion:    l.descripcion as string,
    cantidad:       Number(l.cantidad),
    costo_unitario: Number(l.costo_unitario),
    total:          Number(l.total),
  })) as CompraLinea[]

  // Pago vinculado (si confirmada y con gasto)
  let pagado = 0
  if (compra.gasto_id) {
    const { data: liqs } = await db.from('movimientos_tesoreria')
      .select('monto').eq('client_id', session.client_id)
      .eq('referencia_id', compra.gasto_id).eq('origen', 'PAGO')
    pagado = (liqs ?? []).reduce((s: number, m: { monto: number }) => s + Number(m.monto), 0)
  }

  return {
    compra:         compra as Compra,
    lineas,
    proveedor:      compra.proveedor_id ? { tercero_id: compra.proveedor_id, nombre: page.proveedor_nombres[compra.proveedor_id] ?? compra.proveedor_id } : null,
    almacen:        { almacen_id: compra.almacen_id, nombre: page.almacen_nombres[compra.almacen_id] ?? compra.almacen_id },
    empresa_nombre: page.empresa_nombres[compra.empresa_id] ?? compra.empresa_id,
    proveedores:    page.proveedores,
    almacenes:      page.almacenes,
    productos:      page.productos,
    monedas:        page.monedas,
    pagado,
    saldo:          Math.max(0, Number(compra.total) - pagado),
  }
}

// ── Guardar borrador (crear / editar) ───────────────────────────────────────────

export async function guardarCompra(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; compra_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const compra_id_form = ((formData.get('compra_id')   as string) ?? '').trim()
  const almacen_id     = ((formData.get('almacen_id')  as string) ?? '').trim()
  const proveedor_id   = ((formData.get('proveedor_id') as string) ?? '').trim() || null
  const moneda         = ((formData.get('moneda')      as string) ?? '').trim()
  const fecha          = ((formData.get('fecha')       as string) ?? '').trim() || hoy()
  const notas          = ((formData.get('notas')       as string) ?? '').trim() || null
  const lineas         = parseLineas(formData.get('lineas'))

  if (!almacen_id) return { ok: false, error: 'Selecciona el almacén de entrada.' }
  if (!moneda)     return { ok: false, error: 'Selecciona la moneda.' }
  if (lineas.length === 0) return { ok: false, error: 'Añade al menos una línea con cantidad.' }

  // El almacén determina la empresa
  const { data: alm } = await db.from('almacenes')
    .select('empresa_id').eq('almacen_id', almacen_id).eq('client_id', session.client_id).single()
  if (!alm) return { ok: false, error: 'Almacén no válido.' }
  const empresa_id = alm.empresa_id as string

  const total = lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0)

  // ── Editar (solo BORRADOR) ──
  if (compra_id_form) {
    const { data: existente } = await db.from('compras')
      .select('estado').eq('compra_id', compra_id_form).eq('client_id', session.client_id).single()
    if (!existente)                      return { ok: false, error: 'Compra no encontrada.' }
    if (existente.estado !== 'BORRADOR') return { ok: false, error: 'Solo se pueden editar compras en borrador.' }

    const { error: upErr } = await db.from('compras').update({
      almacen_id, proveedor_id, moneda, fecha, notas, total, empresa_id,
      updated_at: new Date().toISOString(),
    }).eq('compra_id', compra_id_form).eq('client_id', session.client_id)
    if (upErr) return { ok: false, error: upErr.message }

    await db.from('compra_lineas').delete().eq('compra_id', compra_id_form).eq('client_id', session.client_id)
    const { error: linErr } = await db.from('compra_lineas').insert(
      lineas.map((l, i) => ({
        compra_id: compra_id_form, client_id: session.client_id, orden: i,
        producto_id: l.producto_id, descripcion: l.descripcion,
        cantidad: l.cantidad, costo_unitario: l.costo_unitario,
        total: l.cantidad * l.costo_unitario,
      })),
    )
    if (linErr) return { ok: false, error: linErr.message }

    revalidatePath('/portal/compras')
    revalidatePath(`/portal/compras/${compra_id_form}`)
    return { ok: true, compra_id: compra_id_form }
  }

  // ── Crear ──
  const compra_id = generarCompraId()
  let numero: string
  try {
    numero = await siguienteNumeroCompra(db, session.client_id, empresa_id, new Date(fecha).getFullYear())
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de numeración.' }
  }

  const { error: cErr } = await db.from('compras').insert({
    compra_id, numero, client_id: session.client_id, empresa_id,
    proveedor_id, almacen_id, fecha, moneda, estado: 'BORRADOR', total, notas,
    updated_at: new Date().toISOString(),
  })
  if (cErr) return { ok: false, error: cErr.message }

  const { error: linErr } = await db.from('compra_lineas').insert(
    lineas.map((l, i) => ({
      compra_id, client_id: session.client_id, orden: i,
      producto_id: l.producto_id, descripcion: l.descripcion,
      cantidad: l.cantidad, costo_unitario: l.costo_unitario,
      total: l.cantidad * l.costo_unitario,
    })),
  )
  if (linErr) {
    await db.from('compras').delete().eq('compra_id', compra_id).eq('client_id', session.client_id)
    return { ok: false, error: linErr.message }
  }

  revalidatePath('/portal/compras')
  return { ok: true, compra_id }
}

// ── Confirmar: sube stock + crea GASTO 'Compras' (atómico vía Postgres) ─────────
// Todo ocurre en una sola transacción (inv_confirmar_compra): si algo falla,
// ROLLBACK total. Los servicios de las líneas no generan stock pero sí cuentan
// en el gasto. Concurrencia segura (incrementos atómicos).

export async function confirmarCompra(compra_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { error } = await db.rpc('inv_confirmar_compra', {
    p_compra_id: compra_id, p_client_id: session.client_id,
  })
  if (error) return { ok: false, error: traducirErrorInventario(error.message) }

  revalidatePath('/portal/compras')
  revalidatePath(`/portal/compras/${compra_id}`)
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/inventario')
  revalidatePath('/portal/productos')
  return { ok: true }
}

// ── Anular: revierte stock + elimina el gasto y sus pagos (atómico) ─────────────

export async function anularCompra(compra_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { error } = await db.rpc('inv_anular_compra', {
    p_compra_id: compra_id, p_client_id: session.client_id,
  })
  if (error) return { ok: false, error: traducirErrorInventario(error.message) }

  revalidatePath('/portal/compras')
  revalidatePath(`/portal/compras/${compra_id}`)
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/inventario')
  revalidatePath('/portal/productos')
  return { ok: true }
}

// ── Eliminar borrador ────────────────────────────────────────────────────────────

export async function eliminarCompra(compra_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { data: compra } = await db.from('compras')
    .select('estado').eq('compra_id', compra_id).eq('client_id', session.client_id).single()
  if (!compra)                      return { ok: false, error: 'Compra no encontrada.' }
  if (compra.estado !== 'BORRADOR') return { ok: false, error: 'Solo se pueden eliminar borradores. Anula las compras confirmadas.' }

  await db.from('compra_lineas').delete().eq('compra_id', compra_id).eq('client_id', session.client_id)
  const { error } = await db.from('compras').delete()
    .eq('compra_id', compra_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/compras')
  return { ok: true }
}
