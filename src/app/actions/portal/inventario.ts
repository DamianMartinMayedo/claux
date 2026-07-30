'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { parseNumeroEs, parseNumeroEsOpcional } from '@/lib/numeros'
import { consumoDiario, diasDeCobertura, DIAS_VENTANA, type MovimientoConsumo } from '@/lib/inventario/consumo'
import {
  aplicarMovimiento,
  stockEnAlmacen,
  esMotivoValido,
  type TipoMovimiento,
  type MotivoTipo,
} from './_inventario-helpers'
import { LIMITE_LISTADO, rangoUltimosMeses, type FiltroListado } from '@/lib/listados'

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
  /** Motivo tipificado (mig. 154). NULL en todo el histórico anterior, a propósito. */
  motivo_tipo:        MotivoTipo | null
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
  /** Rango realmente aplicado por el servidor, para que la píldora activa no mienta. */
  rango:            { desde: string; hasta: string }
  /** Se tocó el techo de filas: hay más de las que se enseñan. */
  hay_mas:          boolean
  /** Salidas por motivo tipificado en el rango. Es la mitad del valor de los motivos. */
  salidasPorMotivo: { motivo: MotivoTipo; unidades: number; movimientos: number }[]
}

// ── Obtener ───────────────────────────────────────────────────────────────────

export async function obtenerMovimientos(
  filtro?: FiltroListado,
): Promise<MovimientosPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  // Traía `.limit(500)` SIN rango y sin aviso, y el contador «X de Y» usaba la Y ya
  // truncada: no había ni pista de que faltaran filas. Y la descarga sí se llevaba
  // el rango completo, así que pantalla y fichero decían cosas distintas.
  // Mismo contrato que los listados de Contabilidad (src/lib/listados.ts).
  const porDefecto = rangoUltimosMeses(3)
  const desde  = filtro?.desde ?? porDefecto.desde
  const hasta  = filtro?.hasta ?? porDefecto.hasta
  const limite = filtro?.limite ?? LIMITE_LISTADO

  let movQuery = db.from('movimientos_inventario').select('*')
    .eq('client_id', session.client_id)
  if (desde) movQuery = movQuery.gte('fecha', desde)
  if (hasta) movQuery = movQuery.lte('fecha', hasta)
  movQuery = movQuery
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limite)

  const [movRes, prodRes, almRes] = await Promise.all([
    movQuery,
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

  // Salidas por motivo: un `group by` sobre lo que ya está cargado. Solo SALIDA y la
  // pata saliente de un AJUSTE negativo — una entrada no es una pérdida.
  const porMotivo = new Map<MotivoTipo, { unidades: number; movimientos: number }>()
  for (const m of movimientos) {
    if (!m.motivo_tipo) continue
    const sale = m.tipo === 'SALIDA' || (m.tipo === 'AJUSTE' && m.cantidad < 0)
    if (!sale) continue
    const acc = porMotivo.get(m.motivo_tipo) ?? { unidades: 0, movimientos: 0 }
    acc.unidades += Math.abs(Number(m.cantidad))
    acc.movimientos++
    porMotivo.set(m.motivo_tipo, acc)
  }

  return {
    movimientos,
    productos,
    almacenes,
    producto_nombres,
    almacen_nombres,
    empresa_nombres,
    rango: { desde, hasta },
    hay_mas: movimientos.length >= limite,
    salidasPorMotivo: [...porMotivo]
      .map(([motivo, v]) => ({ motivo, ...v }))
      .sort((a, b) => b.unidades - a.unidades),
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
  const motivoTipoR = ((formData.get('motivo_tipo') as string) ?? '').trim()
  const motivo_tipo: MotivoTipo | null = esMotivoValido(motivoTipoR) ? motivoTipoR : null
  const fecha       = ((formData.get('fecha')       as string) ?? '').trim() || new Date().toISOString().split('T')[0]
  const cantidadRaw = parseNumeroEs((formData.get('cantidad') as string) ?? '')
  // Opcional: sin escribir nada es NULL, que no es lo mismo que un coste de 0.
  const costo       = parseNumeroEsOpcional(formData.get('costo_unitario') as string)

  if (!['ENTRADA', 'SALIDA', 'AJUSTE', 'TRANSFERENCIA'].includes(tipo))
    return { ok: false, error: 'Tipo de movimiento no válido.' }
  if (!producto_id) return { ok: false, error: 'Selecciona un producto.' }
  if (!almacen_id)  return { ok: false, error: 'Selecciona un almacén.' }
  if (cantidadRaw === 0)
    return { ok: false, error: 'La cantidad debe ser un número distinto de cero.' }
  // La SALIDA es justo la que necesita un porqué —merma, rotura, autoconsumo— y era
  // la única que no lo pedía: quedaba como «—» en el ledger y la merma no se podía
  // sumar nunca. Obligatorio en SALIDA y AJUSTE; opcional en el resto.
  if ((tipo === 'SALIDA' || tipo === 'AJUSTE') && !motivo_tipo)
    return { ok: false, error: 'Elige el motivo del movimiento.' }
  // Fechar en el futuro no es un movimiento, es una intención: no hay stock que mover.
  if (fecha > new Date().toISOString().split('T')[0])
    return { ok: false, error: 'La fecha no puede ser futura.' }

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
    const disp = await stockEnAlmacen(db, session.client_id, producto_id, almacen_id)
    if (cantidad > disp)
      return { ok: false, error: `Stock insuficiente en ${alm.nombre}. Disponible: ${disp}.` }
  }
  if (tipo === 'AJUSTE') {
    const disp = await stockEnAlmacen(db, session.client_id, producto_id, almacen_id)
    if (disp + cantidad < 0)
      return { ok: false, error: `El ajuste dejaría el stock en negativo. Disponible: ${disp}.` }
  }
  if (tipo === 'TRANSFERENCIA') {
    if (!destino_id)              return { ok: false, error: 'Selecciona el almacén destino.' }
    if (destino_id === almacen_id) return { ok: false, error: 'El destino debe ser distinto del origen.' }
    // Se valida que el destino sea del cliente, NO que sea de la misma empresa: mover
    // mercancía entre empresas es un flujo real y se permite. Lo que no puede ser es
    // que sea invisible — el aviso lo da la UI y el movimiento queda sellado con la
    // empresa del ORIGEN. La versión completa (préstamo entre empresas con su saldo)
    // no existe en el modelo y está en el backlog transversal.
    const { data: dest } = await db.from('almacenes')
      .select('almacen_id').eq('almacen_id', destino_id).eq('client_id', session.client_id).single()
    if (!dest) return { ok: false, error: 'Almacén destino no encontrado.' }
    const disp = await stockEnAlmacen(db, session.client_id, producto_id, almacen_id)
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
      motivo_tipo,
      origen:             'MANUAL',
      referencia_id:      ((formData.get('referencia_id') as string) ?? '').trim() || null,
    })
    revalidatePath('/portal/inventario')
    revalidatePath('/portal/productos')
    revalidatePath('/portal/almacenes')
    return { ok: true, movimiento_id: res.movimiento_id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error al registrar el movimiento.' }
  }
}

/**
 * Revierte un movimiento creando el contrario.
 *
 * En el ledger no se corrige borrando —eso rompería la fuente de verdad—: se corrige
 * con otro movimiento que apunta al original. Antes, un movimiento mal metido solo se
 * podía compensar a mano y sin ningún rastro de que era una corrección.
 */
export async function revertirMovimiento(
  movimiento_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: m } = await db.from('movimientos_inventario').select('*')
    .eq('movimiento_id', movimiento_id).eq('client_id', session.client_id).maybeSingle()
  if (!m) return { ok: false, error: 'Movimiento no encontrado.' }

  const mov = m as Movimiento
  if (mov.origen !== 'MANUAL')
    return { ok: false, error: 'Solo se revierten movimientos manuales. Los de compras y ventas se deshacen anulando su documento.' }

  // El contrario de cada tipo. La transferencia se revierte cambiando los almacenes
  // de sitio, no con un tipo distinto.
  const inverso: Record<TipoMovimiento, TipoMovimiento> = {
    ENTRADA: 'SALIDA', SALIDA: 'ENTRADA', AJUSTE: 'AJUSTE', TRANSFERENCIA: 'TRANSFERENCIA',
  }
  try {
    await aplicarMovimiento(db, {
      client_id:  session.client_id,
      empresa_id: mov.empresa_id,
      fecha:      new Date().toISOString().split('T')[0],
      tipo:       inverso[mov.tipo],
      producto_id: mov.producto_id,
      almacen_id:  mov.tipo === 'TRANSFERENCIA' ? (mov.almacen_destino_id ?? mov.almacen_id) : mov.almacen_id,
      almacen_destino_id: mov.tipo === 'TRANSFERENCIA' ? mov.almacen_id : null,
      cantidad:   mov.tipo === 'AJUSTE' ? -Number(mov.cantidad) : Math.abs(Number(mov.cantidad)),
      motivo:     `Reverso de ${mov.movimiento_id}`,
      motivo_tipo: 'OTRO',
      origen:     'MANUAL',
      referencia_id: mov.movimiento_id,
    })
    revalidatePath('/portal/inventario')
    revalidatePath('/portal/productos')
    revalidatePath('/portal/almacenes')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo revertir el movimiento.' }
  }
}

// ── Reconciliar stock desde el ledger ───────────────────────────────────────────
// Reconstruye stock_almacenes y products.stock_actual a partir de
// movimientos_inventario (la fuente de verdad). Red de seguridad ante cualquier
// descuadre. Atómico vía la función Postgres inv_recalcular_stock.

export interface CambioRecalculo {
  producto: string
  almacen:  string
  antes:    number
  despues:  number
}

/**
 * Recalcula y **dice qué cambió**.
 *
 * Antes devolvía «(N productos)», que es cuántos actualizó, no cuántos
 * descuadraban: un recálculo inocuo y uno que arregla 12 kg daban el mismo
 * mensaje, así que el dueño no podía saber si el botón había hecho algo.
 *
 * La RPC NO se toca —es la red de seguridad del módulo—: se lee el stock antes,
 * se llama, se lee después y se diferencia aquí. Dos consultas más a cambio de
 * una respuesta de verdad.
 */
export async function reconciliarStock(): Promise<{
  ok: boolean; error?: string; productos?: number; cambios?: CambioRecalculo[]
}> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const foto = async () => {
    const { data } = await db.from('stock_almacenes')
      .select('producto_id, almacen_id, cantidad').eq('client_id', session.client_id)
    return new Map(((data ?? []) as { producto_id: string; almacen_id: string; cantidad: number }[])
      .map(s => [`${s.producto_id}@${s.almacen_id}`, Number(s.cantidad)]))
  }

  const antes = await foto()
  const { data, error } = await db.rpc('inv_recalcular_stock', { p_client_id: session.client_id })
  if (error) return { ok: false, error: error.message }
  const despues = await foto()

  const [{ data: prods }, { data: alms }] = await Promise.all([
    db.from('products').select('producto_id, nombre').eq('client_id', session.client_id),
    db.from('almacenes').select('almacen_id, nombre').eq('client_id', session.client_id),
  ])
  const nombreProd = new Map((prods ?? []).map(p => [p.producto_id as string, p.nombre as string]))
  const nombreAlm  = new Map((alms  ?? []).map(a => [a.almacen_id  as string, a.nombre as string]))

  const cambios: CambioRecalculo[] = []
  for (const clave of new Set([...antes.keys(), ...despues.keys()])) {
    const a = antes.get(clave)   ?? 0
    const d = despues.get(clave) ?? 0
    if (Math.abs(a - d) < 0.0005) continue
    const [producto_id, almacen_id] = clave.split('@')
    cambios.push({
      producto: nombreProd.get(producto_id) ?? producto_id,
      almacen:  nombreAlm.get(almacen_id)   ?? almacen_id,
      antes: a, despues: d,
    })
  }

  revalidatePath('/portal/inventario')
  revalidatePath('/portal/productos')
  revalidatePath('/portal/almacenes')
  return {
    ok: true,
    productos: Number((data as { productos?: number } | null)?.productos ?? 0),
    cambios,
  }
}

// ── Panel «Revisar» ────────────────────────────────────────────────────────────
//
// Todo lo que hoy solo se ve consultando la base de datos, en una pantalla y con
// la acción que lo arregla al lado. El stock negativo entra aquí, NO en la campana:
// está permitido a propósito (el dueño vende de mostrador con el sistema por
// detrás) y una alerta diaria por algo que ya acepta convierte la bandeja en ruido.
// Aquí es información, no alarma.

export type TipoAvisoRevision =
  | 'stock_negativo'
  | 'producto_archivado_con_stock'
  | 'almacen_archivado_con_stock'
  | 'producto_sin_coste'

export interface AvisoRevision {
  tipo:        TipoAvisoRevision
  producto_id: string
  producto:    string
  almacen_id:  string | null
  almacen:     string | null
  cantidad:    number
  unidad:      string
  /** De dónde vino, cuando se puede saber: el último movimiento que lo causó. */
  causa:       string | null
  /** Días de cobertura estimados (Fase 7). `null` si no hay con qué estimar. */
  cobertura:   number | null
}

export async function obtenerRevision(): Promise<AvisoRevision[]> {
  const session = await getPortalSession()
  if (!session) return []

  const db = createAdminClient()
  const desdeConsumo = new Date(Date.now() - DIAS_VENTANA * 86_400_000).toISOString().split('T')[0]
  const [{ data: stock }, { data: prods }, { data: alms }, { data: movsConsumo }] = await Promise.all([
    db.from('stock_almacenes').select('producto_id, almacen_id, cantidad').eq('client_id', session.client_id),
    db.from('products').select('producto_id, nombre, unidad, estado, tipo, costos').eq('client_id', session.client_id),
    db.from('almacenes').select('almacen_id, nombre, activo').eq('client_id', session.client_id),
    db.from('movimientos_inventario')
      .select('producto_id, almacen_id, almacen_destino_id, tipo, origen, cantidad, fecha')
      .eq('client_id', session.client_id)
      .in('tipo', ['SALIDA', 'TRANSFERENCIA'])
      .gte('fecha', desdeConsumo),
  ])
  const consumo = consumoDiario((movsConsumo ?? []) as MovimientoConsumo[])

  type Stk = { producto_id: string; almacen_id: string; cantidad: number }
  type Prd = { producto_id: string; nombre: string; unidad: string; estado: string; tipo: string; costos: Record<string, number> | null }
  const filas   = (stock ?? []) as Stk[]
  const prodDe  = new Map(((prods ?? []) as Prd[]).map(p => [p.producto_id, p]))
  const almDe   = new Map(((alms ?? []) as { almacen_id: string; nombre: string; activo: boolean }[])
    .map(a => [a.almacen_id, a]))

  // Los negativos necesitan su causa: el último movimiento que dejó el saldo así.
  const negativos = filas.filter(f => f.cantidad < -0.0005)
  const causaDe = new Map<string, string>()
  if (negativos.length > 0) {
    const { data: movs } = await db.from('movimientos_inventario')
      .select('producto_id, almacen_id, fecha, tipo, origen, motivo')
      .eq('client_id', session.client_id)
      .in('producto_id', [...new Set(negativos.map(n => n.producto_id))])
      .order('created_at', { ascending: false })
      .limit(300)
    for (const m of (movs ?? []) as { producto_id: string; almacen_id: string; fecha: string; origen: string; motivo: string | null }[]) {
      const clave = `${m.producto_id}@${m.almacen_id}`
      if (causaDe.has(clave)) continue                  // ya tenemos el más reciente
      const de = m.origen === 'VENTA' ? 'una venta' : m.origen === 'COMPRA' ? 'una compra' : (m.motivo || 'un movimiento manual')
      causaDe.set(clave, `Desde ${de} del ${m.fecha}: se sacó mercancía de un almacén sin existencias.`)
    }
  }

  const avisos: AvisoRevision[] = []

  for (const f of filas) {
    const p = prodDe.get(f.producto_id)
    const a = almDe.get(f.almacen_id)
    if (!p) continue
    // Un servicio no tiene existencias: la mig. 157 borró el resto viejo y puso el
    // candado en inv_aplicar_movimiento, así que esto no debería darse. Se queda por
    // si acaso: una fila así el dueño NO puede arreglarla —el ajuste la rechaza y el
    // conteo no la lista— y se quedaría para siempre en «Revisar» diciendo que hay
    // trabajo pendiente. Limpieza nuestra, no suya.
    if (p.tipo === 'SERVICIO') continue
    const base = {
      producto_id: f.producto_id,
      producto:    p.nombre,
      almacen_id:  f.almacen_id,
      almacen:     a?.nombre ?? f.almacen_id,
      cantidad:    Number(f.cantidad),
      unidad:      p.unidad ?? '',
      cobertura:   diasDeCobertura(Number(f.cantidad), consumo.get(`${f.producto_id}@${f.almacen_id}`)),
    }
    if (f.cantidad < -0.0005) {
      avisos.push({ ...base, tipo: 'stock_negativo', causa: causaDe.get(`${f.producto_id}@${f.almacen_id}`) ?? null })
    }
    if (Math.abs(f.cantidad) > 0.0005 && p.estado === 'INACTIVO') {
      avisos.push({ ...base, tipo: 'producto_archivado_con_stock', causa: null })
    }
    if (Math.abs(f.cantidad) > 0.0005 && a && !a.activo) {
      avisos.push({ ...base, tipo: 'almacen_archivado_con_stock', causa: null })
    }
  }

  // Sin coste no hay valor de inventario: el producto no vale 0, es que no se sabe.
  const conStock = new Map<string, number>()
  for (const f of filas) conStock.set(f.producto_id, (conStock.get(f.producto_id) ?? 0) + Number(f.cantidad))
  for (const [producto_id, total] of conStock) {
    const p = prodDe.get(producto_id)
    if (!p || p.estado !== 'ACTIVO' || p.tipo === 'SERVICIO' || total <= 0.0005) continue
    if (p.costos && Object.keys(p.costos).length > 0) continue
    avisos.push({
      tipo: 'producto_sin_coste', producto_id, producto: p.nombre,
      almacen_id: null, almacen: null, cantidad: total, unidad: p.unidad ?? '',
      causa: null, cobertura: null,
    })
  }

  // Lo que se acaba antes, arriba: es el orden con el que se decide qué mirar.
  // Sin estimación va al final (no delante, que sería fingir urgencia).
  avisos.sort((a, b) => (a.cobertura ?? Number.MAX_SAFE_INTEGER) - (b.cobertura ?? Number.MAX_SAFE_INTEGER))
  return avisos
}
