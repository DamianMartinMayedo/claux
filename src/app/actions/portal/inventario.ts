'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import {
  aplicarMovimiento,
  stockEnAlmacen,
  type TipoMovimiento,
} from './_inventario-helpers'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface Movimiento {
  movimiento_id:      string
  client_id:          string
  empresa_id:         string
  fecha:              string
  tipo:               TipoMovimiento
  producto_id:        string
  almacen_id:         string
  almacen_destino_id: string | null
  cantidad:           number
  costo_unitario:     number | null
  motivo:             string | null
  origen:             'MANUAL' | 'COMPRA' | 'VENTA'
  referencia_id:      string | null
  created_at:         string
}

export interface ProductoLite {
  producto_id: string
  codigo:      string
  nombre:      string
  unidad:      string
  tipo:        'PRODUCTO' | 'SERVICIO'
}

export interface AlmacenLite {
  almacen_id: string
  nombre:     string
  empresa_id: string
}

export interface MovimientosPageData {
  movimientos:      Movimiento[]
  productos:        ProductoLite[]   // solo PRODUCTO activos (los servicios no tienen stock)
  almacenes:        AlmacenLite[]    // activos
  producto_nombres: Record<string, string>
  almacen_nombres:  Record<string, string>
  empresa_nombres:  Record<string, string>
}

// ── Obtener ───────────────────────────────────────────────────────────────────

export async function obtenerMovimientos(): Promise<MovimientosPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [movRes, prodRes, almRes] = await Promise.all([
    db.from('movimientos_inventario').select('*')
      .eq('client_id', session.client_id)
      .order('created_at', { ascending: false })
      .limit(500),
    db.from('products')
      .select('producto_id, codigo, nombre, unidad, tipo')
      .eq('client_id', session.client_id)
      .eq('estado', 'ACTIVO')
      .eq('tipo', 'PRODUCTO')
      .order('nombre'),
    db.from('almacenes')
      .select('almacen_id, nombre, empresa_id')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .eq('activo', true)
      .order('nombre'),
  ])

  const productos = (prodRes.data ?? []) as ProductoLite[]
  const almacenes = (almRes.data  ?? []) as AlmacenLite[]

  const producto_nombres: Record<string, string> = {}
  for (const p of productos) producto_nombres[p.producto_id] = p.nombre
  const almacen_nombres: Record<string, string> = {}
  for (const a of almacenes) almacen_nombres[a.almacen_id] = a.nombre
  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  // Nombres de productos que aparecen en movimientos pero ya no están activos
  const movimientos = (movRes.data ?? []) as Movimiento[]
  const faltantes = Array.from(new Set(
    movimientos.map(m => m.producto_id).filter(id => !producto_nombres[id]),
  ))
  if (faltantes.length) {
    const { data: extra } = await db.from('products')
      .select('producto_id, nombre')
      .eq('client_id', session.client_id)
      .in('producto_id', faltantes)
    for (const p of (extra ?? []) as { producto_id: string; nombre: string }[]) {
      producto_nombres[p.producto_id] = p.nombre
    }
  }

  return {
    movimientos,
    productos,
    almacenes,
    producto_nombres,
    almacen_nombres,
    empresa_nombres,
  }
}

// ── Registrar movimiento manual ────────────────────────────────────────────────

export async function registrarMovimiento(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; movimiento_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const tipo        = ((formData.get('tipo')        as string) ?? '').trim() as TipoMovimiento
  const producto_id = ((formData.get('producto_id') as string) ?? '').trim()
  const almacen_id  = ((formData.get('almacen_id')  as string) ?? '').trim()
  const destino_id  = ((formData.get('almacen_destino_id') as string) ?? '').trim() || null
  const motivo      = ((formData.get('motivo')      as string) ?? '').trim() || null
  const fecha       = ((formData.get('fecha')       as string) ?? '').trim() || new Date().toISOString().split('T')[0]
  const cantidadRaw = parseFloat((formData.get('cantidad') as string) ?? '')
  const costoRaw    = (formData.get('costo_unitario') as string) ?? ''
  const costo       = costoRaw.trim() ? (parseFloat(costoRaw) || 0) : null

  if (!['ENTRADA', 'SALIDA', 'AJUSTE', 'TRANSFERENCIA'].includes(tipo))
    return { ok: false, error: 'Tipo de movimiento no válido.' }
  if (!producto_id) return { ok: false, error: 'Selecciona un producto.' }
  if (!almacen_id)  return { ok: false, error: 'Selecciona un almacén.' }
  if (isNaN(cantidadRaw) || cantidadRaw === 0)
    return { ok: false, error: 'La cantidad debe ser un número distinto de cero.' }

  // AJUSTE admite signo (delta); el resto trabaja con magnitud positiva.
  const cantidad = tipo === 'AJUSTE' ? cantidadRaw : Math.abs(cantidadRaw)

  const db = createAdminClient()

  // Validar producto y obtener empresa del almacén origen
  const { data: prod } = await db.from('products')
    .select('tipo').eq('producto_id', producto_id).eq('client_id', session.client_id).single()
  if (!prod)                    return { ok: false, error: 'Producto no encontrado.' }
  if (prod.tipo === 'SERVICIO') return { ok: false, error: 'Los servicios no tienen stock.' }

  const { data: alm } = await db.from('almacenes')
    .select('empresa_id, nombre').eq('almacen_id', almacen_id).eq('client_id', session.client_id).single()
  if (!alm) return { ok: false, error: 'Almacén no encontrado.' }

  // Validaciones de disponibilidad
  if (tipo === 'SALIDA') {
    const disp = await stockEnAlmacen(db, producto_id, almacen_id)
    if (cantidad > disp)
      return { ok: false, error: `Stock insuficiente en ${alm.nombre}. Disponible: ${disp}.` }
  }
  if (tipo === 'AJUSTE') {
    const disp = await stockEnAlmacen(db, producto_id, almacen_id)
    if (disp + cantidad < 0)
      return { ok: false, error: `El ajuste dejaría el stock en negativo. Disponible: ${disp}.` }
    if (!motivo) return { ok: false, error: 'El motivo del ajuste es obligatorio.' }
  }
  if (tipo === 'TRANSFERENCIA') {
    if (!destino_id)              return { ok: false, error: 'Selecciona el almacén destino.' }
    if (destino_id === almacen_id) return { ok: false, error: 'El destino debe ser distinto del origen.' }
    const { data: dest } = await db.from('almacenes')
      .select('almacen_id').eq('almacen_id', destino_id).eq('client_id', session.client_id).single()
    if (!dest) return { ok: false, error: 'Almacén destino no encontrado.' }
    const disp = await stockEnAlmacen(db, producto_id, almacen_id)
    if (cantidad > disp)
      return { ok: false, error: `Stock insuficiente en ${alm.nombre}. Disponible: ${disp}.` }
  }

  try {
    const res = await aplicarMovimiento(db, {
      client_id:          session.client_id,
      empresa_id:         alm.empresa_id,
      fecha,
      tipo,
      producto_id,
      almacen_id,
      almacen_destino_id: tipo === 'TRANSFERENCIA' ? destino_id : null,
      cantidad,
      costo_unitario:     tipo === 'ENTRADA' ? costo : null,
      motivo,
      origen:             'MANUAL',
    })
    revalidatePath('/portal/inventario')
    revalidatePath('/portal/productos')
    return { ok: true, movimiento_id: res.movimiento_id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error al registrar el movimiento.' }
  }
}

// ── Reconciliar stock desde el ledger ───────────────────────────────────────────
// Reconstruye stock_almacenes y products.stock_actual a partir de
// movimientos_inventario (la fuente de verdad). Red de seguridad ante cualquier
// descuadre. Atómico vía la función Postgres inv_recalcular_stock.

export async function reconciliarStock(): Promise<{ ok: boolean; error?: string; productos?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data, error } = await db.rpc('inv_recalcular_stock', { p_client_id: session.client_id })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/inventario')
  revalidatePath('/portal/productos')
  return { ok: true, productos: Number((data as { productos?: number } | null)?.productos ?? 0) }
}
