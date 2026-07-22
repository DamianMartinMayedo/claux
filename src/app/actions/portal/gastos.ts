'use server'

import { revalidatePath }    from 'next/cache'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { monedaValida }      from '@/lib/tasas'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type TipoRegistro   = 'GASTO' | 'COBRO'
export type EstadoRegistro = 'PENDIENTE' | 'PARCIAL' | 'LIQUIDADO'
export type EstadoCategoria = 'ACTIVO' | 'INACTIVO'

export interface CategoriaGasto {
  categoria_id:  string
  client_id:     string
  nombre:        string
  descripcion:   string | null
  parent_id:     string | null  // null = categoría raíz; fijo = subcategoría
  estado:        EstadoCategoria
  es_sistema:    boolean
  uso_count?:    number  // Calculado: cuántos gastos usan esta categoría
  created_at:    string
  updated_at:    string
}

export interface GastoCobro {
  registro_id:  string
  client_id:    string
  empresa_id:   string
  tipo:         TipoRegistro
  fecha:        string
  vencimiento:  string | null
  tercero_id:   string | null
  categoria:    string | null  // nombre desnormalizado (display / reportes)
  categoria_id: string | null  // FK a categorias_gastos
  descripcion:  string
  moneda:       string
  monto:        number
  notas:        string | null
  created_at:   string
  updated_at:   string
}

// Liquidación = movimiento de tesorería con referencia a este registro
export interface Liquidacion {
  movimiento_id: string
  fecha:         string
  monto:         number
  cuenta_id:     string
  cuenta_nombre: string
}

export interface GastoCobroConSaldo extends GastoCobro {
  monto_liquidado: number
  saldo_pendiente: number
  estado:          EstadoRegistro
  liquidaciones:   Liquidacion[]
}

export interface GastosCobrosPageData {
  registros:         GastoCobroConSaldo[]
  terceros:          { tercero_id: string; nombre: string; tipo: string; empresa_id: string; moneda_defecto: string | null }[]
  cuentas:           { cuenta_id: string; nombre: string; empresa_id: string; moneda: string }[]
  monedas:           string[]
  categorias_gastos: CategoriaGasto[]  // Lista de categorías de gastos
  empresa_nombres:   Record<string, string>
  empresas:          { empresa_id: string; nombre: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EPS = 0.005

function generarRegistroId(tipo: TipoRegistro): string {
  const pre = tipo === 'GASTO' ? 'GAS' : 'COB'
  return `${pre}-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
function generarCategoriaGastoId(): string {
  return `CATGAS-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
function generarMovimientoId(): string {
  return `MOV-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
function hoy(): string {
  return new Date().toISOString().split('T')[0]
}
function estadoDe(monto: number, liquidado: number): EstadoRegistro {
  if (liquidado <= EPS)            return 'PENDIENTE'
  if (liquidado >= monto - EPS)    return 'LIQUIDADO'
  return 'PARCIAL'
}

// ── Obtener gastos y cobros ────────────────────────────────────────────────────

export async function obtenerGastosCobros(): Promise<GastosCobrosPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [regRes, movRes, cuRes, terRes, monRes, catRes] = await Promise.all([
    db.from('gastos_cobros').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('movimientos_tesoreria')
      .select('movimiento_id, fecha, monto, monto_ref, cuenta_id, referencia_id, origen')
      .eq('client_id', session.client_id)
      .in('origen', ['PAGO', 'COBRO'])
      .not('referencia_id', 'is', null),
    db.from('cuentas').select('cuenta_id, nombre, empresa_id, moneda, activa')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('nombre'),
    db.from('third_parties').select('tercero_id, nombre, tipo, empresa_id, moneda_defecto')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .eq('activo', true)
      .order('nombre'),
    db.from('monedas').select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('codigo'),
    db.from('categorias_gastos').select('*')
      .eq('client_id', session.client_id)
      .order('estado', { ascending: true })  // ACTIVO primero
      .order('nombre'),
  ])

  const registros = (regRes.data ?? []) as GastoCobro[]
  const movs      = (movRes.data ?? []) as { movimiento_id: string; fecha: string; monto: number; monto_ref: number | null; cuenta_id: string; referencia_id: string }[]
  const cuentas   = (cuRes.data  ?? []) as { cuenta_id: string; nombre: string; empresa_id: string; moneda: string; activa: boolean }[]

  const cuentaNombre: Record<string, string> = {}
  for (const c of cuentas) cuentaNombre[c.cuenta_id] = c.nombre

  // Agrupar liquidaciones por registro
  const liqsPorRegistro = new Map<string, Liquidacion[]>()
  for (const m of movs) {
    const arr = liqsPorRegistro.get(m.referencia_id) ?? []
    arr.push({
      movimiento_id: m.movimiento_id,
      fecha:         m.fecha,
      // Importe aplicado al registro en su moneda (monto_ref); reconcilia el saldo
      monto:         Number(m.monto_ref ?? m.monto),
      cuenta_id:     m.cuenta_id,
      cuenta_nombre: cuentaNombre[m.cuenta_id] ?? m.cuenta_id,
    })
    liqsPorRegistro.set(m.referencia_id, arr)
  }

  const registrosConSaldo: GastoCobroConSaldo[] = registros.map(r => {
    const liqs            = liqsPorRegistro.get(r.registro_id) ?? []
    const monto_liquidado = liqs.reduce((s, l) => s + l.monto, 0)
    const monto           = Number(r.monto)
    return {
      ...r,
      monto,
      monto_liquidado,
      saldo_pendiente: Math.max(0, monto - monto_liquidado),
      estado:          estadoDe(monto, monto_liquidado),
      liquidaciones:   liqs.sort((a, b) => b.fecha.localeCompare(a.fecha)),
    }
  })

  // Categorías de gastos con conteo de uso
  const categoriasRaw = (catRes.data ?? []) as CategoriaGasto[]
  
  // Contar uso de cada categoría en gastos_cobros
  const usoPorCategoria = new Map<string, number>()
  for (const r of registros) {
    if (r.categoria_id) {
      usoPorCategoria.set(r.categoria_id, (usoPorCategoria.get(r.categoria_id) ?? 0) + 1)
    }
  }
  
  // Agregar uso_count y ordenar: ACTIVO primero, luego por uso descendente
  const categorias_gastos = categoriasRaw
    .map(c => ({ ...c, uso_count: usoPorCategoria.get(c.categoria_id) ?? 0 }))
    .sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'ACTIVO' ? -1 : 1
      return b.uso_count - a.uso_count  // Más usadas primero
    })

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  return {
    registros:         registrosConSaldo,
    terceros:          (terRes.data ?? []) as GastosCobrosPageData['terceros'],
    cuentas:           cuentas.filter(c => c.activa).map(c => ({ cuenta_id: c.cuenta_id, nombre: c.nombre, empresa_id: c.empresa_id, moneda: c.moneda })),
    monedas:           ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo),
    categorias_gastos,
    empresa_nombres,
    empresas:          empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
  }
}

// ── Guardar gasto / cobro (crear / editar) ─────────────────────────────────────

export async function guardarGastoCobro(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const registro_id = (formData.get('registro_id') as string)?.trim()
  const tipo        = (formData.get('tipo')        as string)?.trim() as TipoRegistro
  const empresa_id  = (formData.get('empresa_id')  as string)?.trim()
  const fecha       = (formData.get('fecha')       as string)?.trim() || hoy()
  const vencimiento = (formData.get('vencimiento') as string)?.trim() || null
  const tercero_id  = (formData.get('tercero_id')  as string)?.trim() || null
  const categoria_id_in = (formData.get('categoria_id') as string)?.trim() || null
  const conceptoForm = (formData.get('descripcion') as string)?.trim()  // texto libre (solo cobros)
  const moneda      = (formData.get('moneda')      as string)?.trim()
  const montoRaw    = parseFloat(formData.get('monto') as string)
  const notas       = (formData.get('notas')       as string)?.trim() || null

  if (tipo !== 'GASTO' && tipo !== 'COBRO') return { ok: false, error: 'Tipo no válido.' }
  if (!empresa_id)                          return { ok: false, error: 'Debes seleccionar una empresa.' }
  if (isNaN(montoRaw) || montoRaw <= 0)     return { ok: false, error: 'El monto debe ser un número positivo.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  // Etiqueta (columna `descripcion`) y clasificación según el tipo:
  //  · GASTO → se identifica por su categoría (obligatoria); la etiqueta es
  //    «Categoría» o «Categoría · Subcategoría». El texto libre va en notas.
  //  · COBRO → lleva concepto de texto libre; sin categoría.
  let descripcion: string
  let categoria_id: string | null = null
  let categoriaNombre: string | null = null

  if (tipo === 'GASTO') {
    if (!categoria_id_in) return { ok: false, error: 'Debes elegir una categoría para el gasto.' }
    const { data: nodo } = await db.from('categorias_gastos')
      .select('nombre, parent_id, estado')
      .eq('categoria_id', categoria_id_in)
      .eq('client_id', session.client_id)
      .maybeSingle()
    if (!nodo || nodo.estado !== 'ACTIVO') return { ok: false, error: 'Categoría de gasto no válida o inactiva.' }
    categoria_id    = categoria_id_in
    categoriaNombre = nodo.nombre
    descripcion     = nodo.nombre
    if (nodo.parent_id) {
      const { data: padre } = await db.from('categorias_gastos')
        .select('nombre').eq('categoria_id', nodo.parent_id).eq('client_id', session.client_id).maybeSingle()
      if (padre) descripcion = `${padre.nombre} · ${nodo.nombre}`
    }
  } else {
    if (!conceptoForm) return { ok: false, error: 'El concepto es obligatorio.' }
    descripcion = conceptoForm
  }

  if (!registro_id) {
    if (!moneda) return { ok: false, error: 'Debes seleccionar una moneda.' }
    if (!await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
    }
    const { error } = await db.from('gastos_cobros').insert({
      registro_id: generarRegistroId(tipo),
      client_id:   session.client_id,
      empresa_id,
      tipo,
      fecha,
      vencimiento,
      tercero_id,
      categoria:   categoriaNombre,
      categoria_id,
      descripcion,
      moneda,
      monto:       montoRaw,
      notas,
      updated_at:  new Date().toISOString(),
    })
    if (error) return { ok: false, error: error.message }
  } else {
    // Editar — la moneda no se cambia (las liquidaciones quedarían inconsistentes)
    const { error } = await db.from('gastos_cobros')
      .update({ fecha, vencimiento, tercero_id, categoria: categoriaNombre, categoria_id, descripcion, monto: montoRaw, notas, updated_at: new Date().toISOString() })
      .eq('registro_id', registro_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/gastos')
  return { ok: true }
}

// ── Eliminar gasto / cobro ─────────────────────────────────────────────────────
// Solo si no tiene liquidaciones (pagos/cobros). Si las tiene, anúlalas primero.

export async function eliminarGastoCobro(registro_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { count } = await db.from('movimientos_tesoreria')
    .select('movimiento_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id)
    .eq('referencia_id', registro_id)
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'Tiene pagos/cobros registrados. Anúlalos antes de eliminar.' }
  }

  const { error } = await db.from('gastos_cobros').delete()
    .eq('registro_id', registro_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  return { ok: true }
}

// ── Eliminar gastos / cobros en lote ───────────────────────────────────────────
// Reutiliza la acción individual en bucle SECUENCIAL (misma guarda de negocio):
// un registro con pagos/cobros registrados NO se borra → es una omisión esperada,
// no un fallo. La capa de lote solo agrega el resultado.

export interface ResultadoLote {
  hechas:   number
  omitidas: { etiqueta: string; motivo: string }[]
  errores:  { etiqueta: string; error: string }[]
  error?:   string   // fallo global (sesión / permiso)
}

function loteVacio(error?: string): ResultadoLote {
  return { hechas: 0, omitidas: [], errores: [], error }
}

export async function eliminarGastosCobrosEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session) return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('base'))) return loteVacio('No tienes permiso para editar en este módulo.')

  const db = createAdminClient()
  const { data: regs } = await db.from('gastos_cobros')
    .select('registro_id, descripcion')
    .eq('client_id', session.client_id).in('registro_id', ids)

  const res = loteVacio()
  for (const r of (regs ?? []) as { registro_id: string; descripcion: string }[]) {
    const out = await eliminarGastoCobro(r.registro_id)   // reutiliza guarda + gating
    if (out.ok) res.hechas++
    else res.omitidas.push({ etiqueta: r.descripcion, motivo: out.error ?? 'Error' })
  }
  revalidatePath('/portal/gastos')
  revalidarFinanzas()
  return res
}

// ── Registrar liquidación (pago de un gasto / cobro de un ingreso) ──────────────
// Crea un movimiento de Tesorería (origen PAGO/COBRO). Admite pagos parciales.

export async function registrarLiquidacion(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const registro_id = (formData.get('registro_id') as string)?.trim()
  const cuenta_id   = (formData.get('cuenta_id')   as string)?.trim()
  const montoRaw    = parseFloat(formData.get('monto') as string)   // en la moneda del registro
  const tasaRaw     = parseFloat(formData.get('tasa_cambio') as string)
  const fecha       = (formData.get('fecha')       as string)?.trim() || hoy()
  const notas       = (formData.get('notas')       as string)?.trim() || null

  if (!registro_id)                      return { ok: false, error: 'Registro no válido.' }
  if (!cuenta_id)                        return { ok: false, error: 'Debes seleccionar una cuenta.' }
  if (isNaN(montoRaw) || montoRaw <= 0)  return { ok: false, error: 'El monto debe ser un número positivo.' }

  const { data: registro } = await db.from('gastos_cobros')
    .select('tipo, descripcion, categoria_id, moneda, monto')
    .eq('registro_id', registro_id)
    .eq('client_id', session.client_id)
    .single()
  if (!registro) return { ok: false, error: 'Registro no encontrado.' }

  // Obtener nombre de categoría si existe
  let categoriaNombre: string | null = null
  if (registro.categoria_id) {
    const { data: cat } = await db.from('categorias_gastos')
      .select('nombre')
      .eq('categoria_id', registro.categoria_id)
      .eq('client_id', session.client_id)
      .maybeSingle()
    categoriaNombre = cat?.nombre ?? null
  }

  const { data: cuenta } = await db.from('cuentas')
    .select('empresa_id, moneda, activa')
    .eq('cuenta_id', cuenta_id)
    .eq('client_id', session.client_id)
    .single()
  if (!cuenta)        return { ok: false, error: 'Cuenta no encontrada.' }
  if (!cuenta.activa) return { ok: false, error: 'La cuenta está archivada.' }

  // Moneda distinta a la del registro → se aplica tasa (misma lógica que las transferencias).
  // `montoRaw` es el importe en la moneda del registro (reduce su saldo); en la caja
  // entra/sale `montoCaja` = montoRaw × tasa, en la moneda de la caja.
  const cambiaMoneda = cuenta.moneda !== registro.moneda
  const tasa = cambiaMoneda ? tasaRaw : 1
  if (cambiaMoneda && (isNaN(tasa) || tasa <= 0)) {
    return { ok: false, error: `Indica la tasa de cambio para saldar en ${registro.moneda} desde una caja en ${cuenta.moneda}.` }
  }
  const montoCaja = Math.round(montoRaw * tasa * 100) / 100

  // Saldo pendiente actual (en la moneda del registro → se suma monto_ref)
  const { data: liqs } = await db.from('movimientos_tesoreria')
    .select('monto_ref, monto')
    .eq('client_id', session.client_id)
    .eq('referencia_id', registro_id)
  const yaLiquidado = (liqs ?? []).reduce((s, m) => s + Number(m.monto_ref ?? m.monto), 0)
  const pendiente   = Number(registro.monto) - yaLiquidado
  if (montoRaw > pendiente + EPS) {
    return { ok: false, error: `El monto supera el saldo pendiente (${pendiente.toFixed(2)} ${registro.moneda}).` }
  }

  const esGasto = registro.tipo === 'GASTO'
  const conceptoBase = `${esGasto ? 'Pago' : 'Cobro'} · ${registro.descripcion}`
  const { error } = await db.from('movimientos_tesoreria').insert({
    movimiento_id: generarMovimientoId(),
    client_id:     session.client_id,
    empresa_id:    cuenta.empresa_id,
    cuenta_id,
    fecha,
    tipo:          esGasto ? 'EGRESO' : 'INGRESO',
    monto:         montoCaja,             // en la moneda de la caja
    moneda:        cuenta.moneda,
    monto_ref:     montoRaw,              // en la moneda del registro (reduce su saldo)
    concepto:      cambiaMoneda ? `${conceptoBase} (${montoRaw.toFixed(2)} ${registro.moneda} a ${tasa} ${cuenta.moneda}/${registro.moneda})` : conceptoBase,
    categoria:     categoriaNombre,  // Nombre de la categoría para display
    categoria_id:  registro.categoria_id,  // FK para referencia
    origen:        esGasto ? 'PAGO' : 'COBRO',
    referencia_id: registro_id,
    notas,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/rrhh')
  revalidatePath('/portal/nomina')
  revalidatePath('/portal/cxp')
  revalidarFinanzas()
  return { ok: true }
}

// ── Anular liquidación (borra el movimiento de Tesorería asociado) ──────────────

export async function anularLiquidacion(movimiento_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  // Solo movimientos de liquidación (origen PAGO/COBRO con referencia)
  const { data: mov } = await db.from('movimientos_tesoreria')
    .select('origen')
    .eq('movimiento_id', movimiento_id)
    .eq('client_id', session.client_id)
    .single()
  if (!mov) return { ok: false, error: 'Movimiento no encontrado.' }
  if (mov.origen !== 'PAGO' && mov.origen !== 'COBRO') {
    return { ok: false, error: 'Ese movimiento no es una liquidación.' }
  }

  const { error } = await db.from('movimientos_tesoreria').delete()
    .eq('movimiento_id', movimiento_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/rrhh')
  revalidatePath('/portal/nomina')
  revalidatePath('/portal/cxp')
  revalidarFinanzas()
  return { ok: true }
}

// ── CRUD de categorías de gastos ──────────────────────────────────────────────

export async function guardarCategoriaGasto(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; categoria_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const categoria_id_form = (formData.get('categoria_id') as string)?.trim()
  const nombre            = (formData.get('nombre') as string)?.trim()
  const descripcion       = (formData.get('descripcion') as string)?.trim() || null
  const parent_id         = (formData.get('parent_id') as string)?.trim() || null

  if (!nombre) return { ok: false, error: 'El nombre de la categoría es obligatorio.' }

  // Jerarquía: solo 2 niveles (categoría → subcategoría)
  if (parent_id) {
    if (parent_id === categoria_id_form) {
      return { ok: false, error: 'Una categoría no puede ser su propia categoría padre.' }
    }
    const { data: padre } = await db.from('categorias_gastos')
      .select('parent_id')
      .eq('categoria_id', parent_id)
      .eq('client_id', session.client_id)
      .maybeSingle()
    if (!padre)          return { ok: false, error: 'La categoría padre no existe.' }
    if (padre.parent_id) return { ok: false, error: 'Solo se permiten dos niveles: la categoría padre no puede ser a su vez una subcategoría.' }
    // Una categoría que ya tiene subcategorías no puede volverse subcategoría
    if (categoria_id_form) {
      const { count } = await db.from('categorias_gastos')
        .select('categoria_id', { count: 'exact', head: true })
        .eq('client_id', session.client_id)
        .eq('parent_id', categoria_id_form)
      if ((count ?? 0) > 0) {
        return { ok: false, error: 'Esta categoría tiene subcategorías; no puede convertirse en subcategoría de otra.' }
      }
    }
  }

  if (!categoria_id_form) {
    // Crear nueva categoría
    const categoria_id = generarCategoriaGastoId()
    const { error } = await db.from('categorias_gastos').insert({
      categoria_id,
      client_id:   session.client_id,
      nombre,
      descripcion,
      parent_id,
      estado:      'ACTIVO',
      es_sistema:  false,
      updated_at:  new Date().toISOString(),
    })
    if (error) {
      if (error.code === '23505') {  // Unique violation
        return { ok: false, error: 'Ya existe una categoría con ese nombre.' }
      }
      return { ok: false, error: error.message }
    }
    revalidatePath('/portal/gastos')
    return { ok: true, categoria_id }
  } else {
    // Editar categoría existente
    const { data: cat } = await db.from('categorias_gastos')
      .select('es_sistema')
      .eq('categoria_id', categoria_id_form)
      .eq('client_id', session.client_id)
      .maybeSingle()
    
    if (!cat) return { ok: false, error: 'Categoría no encontrada.' }

    const { error } = await db.from('categorias_gastos')
      .update({ nombre, descripcion, parent_id, updated_at: new Date().toISOString() })
      .eq('categoria_id', categoria_id_form)
      .eq('client_id', session.client_id)
    
    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: 'Ya existe una categoría con ese nombre.' }
      }
      return { ok: false, error: error.message }
    }
    // Propagar el nuevo nombre a las filas desnormalizadas (reportes/listados).
    await db.from('gastos_cobros').update({ categoria: nombre })
      .eq('client_id', session.client_id).eq('categoria_id', categoria_id_form)
    await db.from('movimientos_tesoreria').update({ categoria: nombre })
      .eq('client_id', session.client_id).eq('categoria_id', categoria_id_form)
    revalidatePath('/portal/gastos')
    revalidatePath('/portal/tesoreria')
    revalidarFinanzas()
    return { ok: true, categoria_id: categoria_id_form }
  }
}

export async function archivarCategoriaGasto(
  categoria_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  // Verificar que no sea categoría del sistema
  const { data: cat } = await db.from('categorias_gastos')
    .select('es_sistema')
    .eq('categoria_id', categoria_id)
    .eq('client_id', session.client_id)
    .maybeSingle()

  if (!cat) return { ok: false, error: 'Categoría no encontrada.' }
  if (cat.es_sistema) {
    return { ok: false, error: 'Las categorías del sistema no se pueden archivar.' }
  }

  const { error } = await db.from('categorias_gastos')
    .update({ estado: 'INACTIVO', updated_at: new Date().toISOString() })
    .eq('categoria_id', categoria_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  return { ok: true }
}

export async function restaurarCategoriaGasto(
  categoria_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const { error } = await createAdminClient()
    .from('categorias_gastos')
    .update({ estado: 'ACTIVO', updated_at: new Date().toISOString() })
    .eq('categoria_id', categoria_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  return { ok: true }
}
