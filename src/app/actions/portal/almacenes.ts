'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { estadoStock, pideAtencion, minimoAplicable } from '@/lib/inventario/stock'
import { valorarPorMoneda, type ValorMoneda } from '@/lib/inventario/valoracion'
import { consumoDiario, diasDeCobertura, DIAS_VENTANA, type MovimientoConsumo } from '@/lib/inventario/consumo'
import { limiteDelFiltro, type FiltroListado } from '@/lib/listados'
import { comprobarLimite } from '@/lib/limites'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type TipoAlmacen = 'FISICO' | 'VIRTUAL' | 'TRANSITO' | 'CONSIGNACION'


export interface Almacen {
  almacen_id:  string
  client_id:   string
  empresa_id:  string
  nombre:      string
  descripcion: string | null
  tipo:        TipoAlmacen
  activo:      boolean
  created_at:  string
  updated_at:  string
}

/** Lo que hay DENTRO de un almacén, que es la pregunta que la página no respondía. */
export interface ResumenAlmacen {
  referencias: number
  unidades:    number
  /** Valor nativo por moneda, sin convertir (regla de Reportes). */
  valor:       ValorMoneda[]
  /** Parejas (producto, almacén) que piden atención: bajo mínimo o agotado. */
  alertas:     number
  /** Filas en negativo: se informan, no se alarman (decisión de producto). */
  negativos:   number
}

export interface AlmacenesPageData {
  almacenes:       Almacen[]
  empresa_nombres: Record<string, string>   // empresa_id → nombre
  empresas:        { empresa_id: string; nombre: string }[]
  /** almacen_id → qué guarda. Vacío para los que no tienen existencias. */
  resumen:         Record<string, ResumenAlmacen>
  /** Monedas activas del cliente: la valoración sale de ahí, nunca de una lista fija. */
  monedas:         string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generarAlmacenId(): string {
  return `ALM-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

// ── Obtener ───────────────────────────────────────────────────────────────────

export async function obtenerAlmacenes(): Promise<AlmacenesPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db      = createAdminClient()
  const empresas = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)

  const [{ data }, { data: stock }, { data: prods }, { data: cfg }, { data: mon }] = await Promise.all([
    db.from('almacenes').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', empresa_ids.length ? empresa_ids : ['__none__'])
      .order('nombre'),
    db.from('stock_almacenes').select('producto_id, almacen_id, cantidad').eq('client_id', session.client_id),
    db.from('products').select('producto_id, stock_minimo, costos, estado, tipo').eq('client_id', session.client_id),
    db.from('producto_almacen_config').select('producto_id, almacen_id, stock_minimo').eq('client_id', session.client_id),
    db.from('monedas').select('codigo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
  ])

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  const monedas = ((mon ?? []) as { codigo: string }[]).map(m => m.codigo)
  const prodDe  = new Map(((prods ?? []) as { producto_id: string; stock_minimo: number; costos: Record<string, number> | null; estado: string; tipo: string }[])
    .map(p => [p.producto_id, p]))
  const minAlm  = new Map(((cfg ?? []) as { producto_id: string; almacen_id: string; stock_minimo: number | null }[])
    .filter(c => c.stock_minimo != null)
    .map(c => [`${c.producto_id}@${c.almacen_id}`, Number(c.stock_minimo)]))

  const porAlmacen = new Map<string, { producto_id: string; cantidad: number; costos: Record<string, number> | null; minimo: number }[]>()
  for (const s of (stock ?? []) as { producto_id: string; almacen_id: string; cantidad: number }[]) {
    const p = prodDe.get(s.producto_id)
    if (!p || p.tipo === 'SERVICIO') continue
    const filas = porAlmacen.get(s.almacen_id) ?? []
    filas.push({
      producto_id: s.producto_id,
      cantidad:    Number(s.cantidad),
      costos:      p.costos,
      minimo:      minimoAplicable(minAlm.get(`${s.producto_id}@${s.almacen_id}`), p.stock_minimo),
    })
    porAlmacen.set(s.almacen_id, filas)
  }

  const resumen: Record<string, ResumenAlmacen> = {}
  for (const [almacen_id, filas] of porAlmacen) {
    const conStock = filas.filter(f => Math.abs(f.cantidad) > 0.0005)
    resumen[almacen_id] = {
      referencias: conStock.filter(f => f.cantidad > 0.0005).length,
      unidades:    conStock.reduce((s, f) => s + f.cantidad, 0),
      valor:       valorarPorMoneda(conStock, monedas),
      alertas:     filas.filter(f => pideAtencion(estadoStock(f.cantidad, f.minimo))).length,
      negativos:   conStock.filter(f => f.cantidad < 0).length,
    }
  }

  return {
    almacenes:       (data ?? []) as Almacen[],
    empresa_nombres,
    empresas:        empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    resumen,
    monedas,
  }
}

// ── Detalle de un almacén ─────────────────────────────────────────────────────
//
// La página que faltaba. «¿Qué tengo en Playa y cuánto vale?» no tenía respuesta en
// ninguna parte del producto: la lista de almacenes era un CRUD de nombres.

export interface LineaAlmacen {
  producto_id: string
  nombre:      string
  codigo:      string
  unidad:      string
  cantidad:    number
  /** El mínimo que aplica aquí, y si es propio del almacén o heredado del global. */
  minimo:      number
  minimoPropio: number | null
  costo:       number | null
  valor:       number | null
  /**
   * Días que duran estas existencias al ritmo de los últimos 90 días. `null` cuando
   * no hay con qué estimar (sin consumo, poca historia): es una ESTIMACIÓN y se
   * rotula como tal — no se suma en ninguna parte ni genera aviso.
   */
  cobertura:   number | null
}

export interface AlmacenDetalleData {
  almacen:      Almacen
  empresa:      string
  lineas:       LineaAlmacen[]
  valor:        ValorMoneda[]
  monedas:      string[]
  /** Moneda en la que se enseña el detalle por línea (la primera con costes). */
  monedaVista:  string | null
  movimientos:  { movimiento_id: string; fecha: string; tipo: string; producto: string; cantidad: number; motivo: string | null; origen: string }[]
  /** Se tocó el techo: hay más movimientos que los que se traen aquí. */
  movimientosHayMas: boolean
  /** Cuántos hay DE VERDAD, y con qué techo se pidió. Sin el total, el aviso podía decir
   *  que faltaban pero no cuántos, y no había forma de traerlos. */
  movimientosTotal:  number
  movimientosLimite: number
  /**
   * Solo para NO pintar «Contar». No es control de acceso —ese lo hacen las acciones—
   * pero contar es una PÁGINA, no una acción: sin esto, quien no puede editar pulsa el
   * botón y `abrirConteo` le devuelve un rebote sin explicación en vez de un aviso.
   */
  puede_editar: boolean
}

export async function obtenerAlmacenDetalle(
  almacen_id: string, filtro?: FiltroListado,
): Promise<AlmacenDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const { data: alm } = await db.from('almacenes').select('*')
    .eq('almacen_id', almacen_id).eq('client_id', session.client_id).maybeSingle()
  if (!alm) return null

  // Ventana de consumo para la cobertura: 90 días desde hoy.
  const desdeConsumo = new Date(Date.now() - DIAS_VENTANA * 86_400_000).toISOString().split('T')[0]
  const limiteMovs = limiteDelFiltro(filtro)

  const [{ data: stock }, { data: prods }, { data: cfg }, { data: mon }, { data: movs, count: movsCount }, { data: movsConsumo }, empresas] = await Promise.all([
    db.from('stock_almacenes').select('producto_id, cantidad')
      .eq('client_id', session.client_id).eq('almacen_id', almacen_id),
    db.from('products').select('producto_id, nombre, codigo, unidad, stock_minimo, costos, tipo')
      .eq('client_id', session.client_id),
    db.from('producto_almacen_config').select('producto_id, stock_minimo')
      .eq('client_id', session.client_id).eq('almacen_id', almacen_id),
    db.from('monedas').select('codigo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
    // `count: 'exact'`: el aviso tiene que poder decir CUÁNTOS faltan (y ofrecer traerlos).
    db.from('movimientos_inventario')
      .select('movimiento_id, fecha, tipo, producto_id, cantidad, motivo, origen', { count: 'exact' })
      .eq('client_id', session.client_id)
      .or(`almacen_id.eq.${almacen_id},almacen_destino_id.eq.${almacen_id}`)
      .order('created_at', { ascending: false })
      .limit(limiteMovs),
    // Solo las SALIDA/TRANSFERENCIA de este almacén en la ventana: es lo único que
    // `consumoDiario` cuenta, así que no se trae el ledger entero.
    db.from('movimientos_inventario')
      .select('producto_id, almacen_id, almacen_destino_id, tipo, origen, cantidad, fecha')
      .eq('client_id', session.client_id)
      .eq('almacen_id', almacen_id)
      .in('tipo', ['SALIDA', 'TRANSFERENCIA'])
      .gte('fecha', desdeConsumo),
    obtenerEmpresas(),
  ])

  type Prd = { producto_id: string; nombre: string; codigo: string; unidad: string; stock_minimo: number; costos: Record<string, number> | null; tipo: string }
  const prodDe  = new Map(((prods ?? []) as Prd[]).map(p => [p.producto_id, p]))
  const minAlm  = new Map(((cfg ?? []) as { producto_id: string; stock_minimo: number | null }[])
    .filter(c => c.stock_minimo != null).map(c => [c.producto_id, Number(c.stock_minimo)]))
  const monedas = ((mon ?? []) as { codigo: string }[]).map(m => m.codigo)

  const filas = ((stock ?? []) as { producto_id: string; cantidad: number }[])
    .map(s => ({ ...s, p: prodDe.get(s.producto_id) }))
    .filter((s): s is { producto_id: string; cantidad: number; p: Prd } => !!s.p && s.p.tipo !== 'SERVICIO')

  const valor = valorarPorMoneda(
    filas.map(f => ({ producto_id: f.producto_id, cantidad: Number(f.cantidad), costos: f.p.costos })),
    monedas,
  )
  const monedaVista = valor[0]?.moneda ?? null

  const consumo = consumoDiario((movsConsumo ?? []) as MovimientoConsumo[])

  const lineas: LineaAlmacen[] = filas
    .map(f => {
      const cantidad = Number(f.cantidad)
      const costo    = monedaVista ? (f.p.costos?.[monedaVista] ?? null) : null
      return {
        producto_id:  f.producto_id,
        nombre:       f.p.nombre,
        codigo:       f.p.codigo,
        unidad:       f.p.unidad ?? '',
        cantidad,
        minimo:       minimoAplicable(minAlm.get(f.producto_id), f.p.stock_minimo),
        minimoPropio: minAlm.get(f.producto_id) ?? null,
        costo,
        valor:        costo != null && cantidad > 0 ? cantidad * costo : null,
        cobertura:    diasDeCobertura(cantidad, consumo.get(`${f.producto_id}@${almacen_id}`)),
      }
    })
    // Un almacén enseña lo que guarda, incluidos los negativos (que no se esconden)
    // y lo que tiene mínimo propio aunque esté a cero.
    .filter(l => Math.abs(l.cantidad) > 0.0005 || l.minimoPropio != null)
    .sort((a, b) => b.cantidad - a.cantidad)

  const nombreProd = new Map([...prodDe].map(([id, p]) => [id, p.nombre]))

  return {
    almacen:  alm as Almacen,
    empresa:  empresas.find(e => e.empresa_id === (alm as Almacen).empresa_id)?.nombre ?? '',
    lineas,
    valor,
    monedas,
    monedaVista,
    movimientos: ((movs ?? []) as Record<string, unknown>[]).map(m => ({
      movimiento_id: m.movimiento_id as string,
      fecha:         m.fecha as string,
      tipo:          m.tipo as string,
      producto:      nombreProd.get(m.producto_id as string) ?? (m.producto_id as string),
      cantidad:      Number(m.cantidad),
      motivo:        (m.motivo as string) ?? null,
      origen:        m.origen as string,
    })),
    movimientosHayMas: (movs ?? []).length >= limiteMovs,
    movimientosTotal:  movsCount ?? (movs ?? []).length,
    movimientosLimite: limiteMovs,
    puede_editar: await puedeEditarModulo('inventario'),
  }
}

// ── Guardar (crear / editar) ──────────────────────────────────────────────────

export async function guardarAlmacen(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const almacen_id = (formData.get('almacen_id') as string)?.trim()
  const empresa_id = (formData.get('empresa_id') as string)?.trim()
  const nombre     = (formData.get('nombre')     as string)?.trim()
  const descripcion= (formData.get('descripcion') as string)?.trim() || null
  const tipo       = (formData.get('tipo')        as string)?.trim() as TipoAlmacen

  if (!nombre)     return { ok: false, error: 'El nombre del almacén es obligatorio.' }
  if (!empresa_id) return { ok: false, error: 'Debes seleccionar una empresa.' }
  if (!tipo)       return { ok: false, error: 'Debes seleccionar un tipo de almacén.' }

  // Verificar que la empresa pertenece al cliente
  const empresas    = await obtenerEmpresas()
  const empresaValida = empresas.some(e => e.empresa_id === empresa_id)
  if (!empresaValida) return { ok: false, error: 'Empresa no válida.' }

  const payload = {
    empresa_id,
    client_id:   session.client_id,
    nombre,
    descripcion,
    tipo,
    updated_at:  new Date().toISOString(),
  }

  if (!almacen_id) {
    // Crear
    const tope = await comprobarLimite(db, session.client_id, 'almacenes')
    if (tope) return { ok: false, error: tope }

    const { error } = await db.from('almacenes').insert({
      ...payload,
      almacen_id: generarAlmacenId(),
      activo:     true,
    })
    if (error) return { ok: false, error: error.message }
  } else {
    // Editar
    const { error } = await db.from('almacenes')
      .update(payload)
      .eq('almacen_id', almacen_id)
      .eq('client_id',  session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/almacenes')
  return { ok: true }
}

// ── Archivar / restaurar ──────────────────────────────────────────────────────

/**
 * Qué hay dentro de un almacén, para poder DECIRLO antes de archivarlo.
 *
 * Archivar no se prohíbe —es flexibilidad—, pero hoy se hace a ciegas: el almacén
 * desaparece del filtro de movimientos, del modal de ajuste, del formulario de
 * compra y del selector de la factura, mientras sus existencias siguen sumando en
 * el total de cada producto. Eso hay que contarlo antes, no después.
 */
export async function resumenAlmacen(
  almacen_id: string,
): Promise<{ referencias: number; unidades: number }> {
  const session = await getPortalSession()
  if (!session) return { referencias: 0, unidades: 0 }

  const { data } = await createAdminClient()
    .from('stock_almacenes')
    .select('cantidad')
    .eq('client_id', session.client_id)
    .eq('almacen_id', almacen_id)

  const filas = ((data ?? []) as { cantidad: number }[])
    .map(s => Number(s.cantidad))
    .filter(c => Math.abs(c) > 0.0005)

  return {
    referencias: filas.length,
    unidades:    filas.reduce((s, c) => s + c, 0),
  }
}

export async function archivarAlmacen(
  almacen_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const { error } = await createAdminClient()
    .from('almacenes')
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq('almacen_id', almacen_id)
    .eq('client_id',  session.client_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/almacenes')
  return { ok: true }
}

export async function restaurarAlmacen(
  almacen_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  // Desarchivar es crear: el cupo lo mide lo activo, no lo que hubo alguna vez.
  const tope = await comprobarLimite(db, session.client_id, 'almacenes', 1, 'desarchivar')
  if (tope) return { ok: false, error: tope }

  const { error } = await db
    .from('almacenes')
    .update({ activo: true, updated_at: new Date().toISOString() })
    .eq('almacen_id', almacen_id)
    .eq('client_id',  session.client_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/almacenes')
  return { ok: true }
}
