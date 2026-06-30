'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type TipoRegistro   = 'GASTO' | 'COBRO'
export type EstadoRegistro = 'PENDIENTE' | 'PARCIAL' | 'LIQUIDADO'

export interface GastoCobro {
  registro_id:  string
  client_id:    string
  empresa_id:   string
  tipo:         TipoRegistro
  fecha:        string
  vencimiento:  string | null
  tercero_id:   string | null
  categoria:    string | null
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
  registros:       GastoCobroConSaldo[]
  terceros:        { tercero_id: string; nombre: string; tipo: string; empresa_id: string; moneda_defecto: string | null }[]
  cuentas:         { cuenta_id: string; nombre: string; empresa_id: string; moneda: string }[]
  monedas:         string[]
  categorias:      string[]
  empresa_nombres: Record<string, string>
  empresas:        { empresa_id: string; nombre: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EPS = 0.005

function generarRegistroId(tipo: TipoRegistro): string {
  const pre = tipo === 'GASTO' ? 'GAS' : 'COB'
  return `${pre}-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
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

  const [regRes, movRes, cuRes, terRes, monRes] = await Promise.all([
    db.from('gastos_cobros').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('movimientos_tesoreria')
      .select('movimiento_id, fecha, monto, cuenta_id, referencia_id, origen')
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
  ])

  const registros = (regRes.data ?? []) as GastoCobro[]
  const movs      = (movRes.data ?? []) as { movimiento_id: string; fecha: string; monto: number; cuenta_id: string; referencia_id: string }[]
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
      monto:         Number(m.monto),
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

  // Categorías existentes (para datalist)
  const categorias = Array.from(
    new Set(registros.map(r => r.categoria).filter((c): c is string => !!c)),
  ).sort()

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  return {
    registros:  registrosConSaldo,
    terceros:   (terRes.data ?? []) as GastosCobrosPageData['terceros'],
    cuentas:    cuentas.filter(c => c.activa).map(c => ({ cuenta_id: c.cuenta_id, nombre: c.nombre, empresa_id: c.empresa_id, moneda: c.moneda })),
    monedas:    ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo),
    categorias,
    empresa_nombres,
    empresas:   empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
  }
}

// ── Guardar gasto / cobro (crear / editar) ─────────────────────────────────────

export async function guardarGastoCobro(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const registro_id = (formData.get('registro_id') as string)?.trim()
  const tipo        = (formData.get('tipo')        as string)?.trim() as TipoRegistro
  const empresa_id  = (formData.get('empresa_id')  as string)?.trim()
  const fecha       = (formData.get('fecha')       as string)?.trim() || hoy()
  const vencimiento = (formData.get('vencimiento') as string)?.trim() || null
  const tercero_id  = (formData.get('tercero_id')  as string)?.trim() || null
  const categoria   = (formData.get('categoria')   as string)?.trim() || null
  const descripcion = (formData.get('descripcion') as string)?.trim()
  const moneda      = (formData.get('moneda')      as string)?.trim()
  const montoRaw    = parseFloat(formData.get('monto') as string)
  const notas       = (formData.get('notas')       as string)?.trim() || null

  if (tipo !== 'GASTO' && tipo !== 'COBRO') return { ok: false, error: 'Tipo no válido.' }
  if (!descripcion)                         return { ok: false, error: 'La descripción es obligatoria.' }
  if (!empresa_id)                          return { ok: false, error: 'Debes seleccionar una empresa.' }
  if (isNaN(montoRaw) || montoRaw <= 0)     return { ok: false, error: 'El monto debe ser un número positivo.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  if (!registro_id) {
    if (!moneda) return { ok: false, error: 'Debes seleccionar una moneda.' }
    const { error } = await db.from('gastos_cobros').insert({
      registro_id: generarRegistroId(tipo),
      client_id:   session.client_id,
      empresa_id,
      tipo,
      fecha,
      vencimiento,
      tercero_id,
      categoria,
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
      .update({ fecha, vencimiento, tercero_id, categoria, descripcion, monto: montoRaw, notas, updated_at: new Date().toISOString() })
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

// ── Registrar liquidación (pago de un gasto / cobro de un ingreso) ──────────────
// Crea un movimiento de Tesorería (origen PAGO/COBRO). Admite pagos parciales.

export async function registrarLiquidacion(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const registro_id = (formData.get('registro_id') as string)?.trim()
  const cuenta_id   = (formData.get('cuenta_id')   as string)?.trim()
  const montoRaw    = parseFloat(formData.get('monto') as string)
  const fecha       = (formData.get('fecha')       as string)?.trim() || hoy()
  const notas       = (formData.get('notas')       as string)?.trim() || null

  if (!registro_id)                      return { ok: false, error: 'Registro no válido.' }
  if (!cuenta_id)                        return { ok: false, error: 'Debes seleccionar una cuenta.' }
  if (isNaN(montoRaw) || montoRaw <= 0)  return { ok: false, error: 'El monto debe ser un número positivo.' }

  const { data: registro } = await db.from('gastos_cobros')
    .select('tipo, descripcion, categoria, moneda, monto')
    .eq('registro_id', registro_id)
    .eq('client_id', session.client_id)
    .single()
  if (!registro) return { ok: false, error: 'Registro no encontrado.' }

  const { data: cuenta } = await db.from('cuentas')
    .select('empresa_id, moneda, activa')
    .eq('cuenta_id', cuenta_id)
    .eq('client_id', session.client_id)
    .single()
  if (!cuenta)        return { ok: false, error: 'Cuenta no encontrada.' }
  if (!cuenta.activa) return { ok: false, error: 'La cuenta está archivada.' }
  if (cuenta.moneda !== registro.moneda) {
    return { ok: false, error: `La cuenta es en ${cuenta.moneda} y el registro en ${registro.moneda}. Usa una cuenta de la misma moneda.` }
  }

  // Saldo pendiente actual
  const { data: liqs } = await db.from('movimientos_tesoreria')
    .select('monto')
    .eq('client_id', session.client_id)
    .eq('referencia_id', registro_id)
  const yaLiquidado = (liqs ?? []).reduce((s, m) => s + Number(m.monto), 0)
  const pendiente   = Number(registro.monto) - yaLiquidado
  if (montoRaw > pendiente + EPS) {
    return { ok: false, error: `El monto supera el saldo pendiente (${pendiente.toFixed(2)} ${registro.moneda}).` }
  }

  const esGasto = registro.tipo === 'GASTO'
  const { error } = await db.from('movimientos_tesoreria').insert({
    movimiento_id: generarMovimientoId(),
    client_id:     session.client_id,
    empresa_id:    cuenta.empresa_id,
    cuenta_id,
    fecha,
    tipo:          esGasto ? 'EGRESO' : 'INGRESO',
    monto:         montoRaw,
    moneda:        registro.moneda,
    concepto:      `${esGasto ? 'Pago' : 'Cobro'} · ${registro.descripcion}`,
    categoria:     registro.categoria,
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
  revalidatePath('/portal/reportes')
  return { ok: true }
}

// ── Anular liquidación (borra el movimiento de Tesorería asociado) ──────────────

export async function anularLiquidacion(movimiento_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

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
  revalidatePath('/portal/reportes')
  return { ok: true }
}
