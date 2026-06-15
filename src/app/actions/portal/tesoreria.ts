'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type TipoCuenta      = 'CAJA' | 'BANCO' | 'PASARELA' | 'OTRO'
export type TipoMovimiento  = 'INGRESO' | 'EGRESO'
export type OrigenMovimiento = 'MANUAL' | 'COBRO' | 'PAGO' | 'TRANSFERENCIA'

export interface Cuenta {
  cuenta_id:     string
  client_id:     string
  empresa_id:    string
  nombre:        string
  tipo:          TipoCuenta
  moneda:        string
  saldo_inicial: number
  activa:        boolean
  notas:         string | null
  created_at:    string
  updated_at:    string
}

export interface Movimiento {
  movimiento_id:  string
  client_id:      string
  empresa_id:     string
  cuenta_id:      string
  fecha:          string
  tipo:           TipoMovimiento
  monto:          number
  moneda:         string
  concepto:       string
  categoria:      string | null
  origen:         OrigenMovimiento
  referencia_id:  string | null
  transfer_grupo: string | null
  notas:          string | null
  created_at:     string
}

// Cuenta con su saldo calculado (saldo_inicial + Σingresos − Σegresos)
export interface CuentaConSaldo extends Cuenta {
  saldo:          number
  total_ingresos: number
  total_egresos:  number
  num_movimientos: number
}

export interface TesoreriaPageData {
  cuentas:          CuentaConSaldo[]
  movimientos:      Movimiento[]
  saldos_por_moneda: { moneda: string; saldo: number }[]
  empresa_nombres:  Record<string, string>
  empresas:         { empresa_id: string; nombre: string }[]
  monedas:          string[]   // códigos de monedas activas
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generarCuentaId(): string {
  return `CTA-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
function generarMovimientoId(): string {
  return `MOV-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

const TIPOS_CUENTA:     TipoCuenta[]     = ['CAJA', 'BANCO', 'PASARELA', 'OTRO']
const TIPOS_MOVIMIENTO: TipoMovimiento[] = ['INGRESO', 'EGRESO']

// ── Obtener tesorería (cuentas + movimientos + saldos) ─────────────────────────

export async function obtenerTesoreria(): Promise<TesoreriaPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)

  const [cuRes, movRes, monRes] = await Promise.all([
    db.from('cuentas').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', empresa_ids.length ? empresa_ids : ['__none__'])
      .order('nombre'),
    db.from('movimientos_tesoreria').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', empresa_ids.length ? empresa_ids : ['__none__'])
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('monedas').select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('codigo'),
  ])

  const cuentas     = (cuRes.data  ?? []) as Cuenta[]
  const movimientos = (movRes.data ?? []) as Movimiento[]

  // Saldos por cuenta
  const agregados = new Map<string, { ingresos: number; egresos: number; num: number }>()
  for (const m of movimientos) {
    const a = agregados.get(m.cuenta_id) ?? { ingresos: 0, egresos: 0, num: 0 }
    if (m.tipo === 'INGRESO') a.ingresos += Number(m.monto)
    else                      a.egresos  += Number(m.monto)
    a.num += 1
    agregados.set(m.cuenta_id, a)
  }

  const cuentasConSaldo: CuentaConSaldo[] = cuentas.map(c => {
    const a = agregados.get(c.cuenta_id) ?? { ingresos: 0, egresos: 0, num: 0 }
    return {
      ...c,
      saldo_inicial:   Number(c.saldo_inicial),
      total_ingresos:  a.ingresos,
      total_egresos:   a.egresos,
      num_movimientos: a.num,
      saldo:           Number(c.saldo_inicial) + a.ingresos - a.egresos,
    }
  })

  // Totales por moneda (solo cuentas activas)
  const porMoneda = new Map<string, number>()
  for (const c of cuentasConSaldo) {
    if (!c.activa) continue
    porMoneda.set(c.moneda, (porMoneda.get(c.moneda) ?? 0) + c.saldo)
  }
  const saldos_por_moneda = Array.from(porMoneda.entries())
    .map(([moneda, saldo]) => ({ moneda, saldo }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda))

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  return {
    cuentas:           cuentasConSaldo,
    movimientos,
    saldos_por_moneda,
    empresa_nombres,
    empresas:          empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    monedas:           ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo),
  }
}

// ── Guardar cuenta (crear / editar) ────────────────────────────────────────────

export async function guardarCuenta(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const cuenta_id     = (formData.get('cuenta_id')  as string)?.trim()
  const empresa_id    = (formData.get('empresa_id') as string)?.trim()
  const nombre        = (formData.get('nombre')     as string)?.trim()
  const tipo          = (formData.get('tipo')       as string)?.trim() as TipoCuenta
  const moneda        = (formData.get('moneda')     as string)?.trim()
  const saldoRaw      = parseFloat(formData.get('saldo_inicial') as string)
  const saldo_inicial = isNaN(saldoRaw) ? 0 : saldoRaw
  const notas         = (formData.get('notas')      as string)?.trim() || null

  if (!nombre)                          return { ok: false, error: 'El nombre de la cuenta es obligatorio.' }
  if (!empresa_id)                      return { ok: false, error: 'Debes seleccionar una empresa.' }
  if (!moneda)                          return { ok: false, error: 'Debes seleccionar una moneda.' }
  if (!TIPOS_CUENTA.includes(tipo))     return { ok: false, error: 'Tipo de cuenta no válido.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  if (!cuenta_id) {
    // Crear
    const { error } = await db.from('cuentas').insert({
      cuenta_id:  generarCuentaId(),
      client_id:  session.client_id,
      empresa_id,
      nombre,
      tipo,
      moneda,
      saldo_inicial,
      notas,
      activa:     true,
      updated_at: new Date().toISOString(),
    })
    if (error) return { ok: false, error: error.message }
  } else {
    // Editar — la moneda no se cambia tras crear (los movimientos quedarían inconsistentes)
    const { error } = await db.from('cuentas')
      .update({ nombre, tipo, saldo_inicial, notas, updated_at: new Date().toISOString() })
      .eq('cuenta_id', cuenta_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/tesoreria')
  return { ok: true }
}

// ── Archivar / restaurar cuenta ────────────────────────────────────────────────

export async function archivarCuenta(cuenta_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const { error } = await createAdminClient()
    .from('cuentas')
    .update({ activa: false, updated_at: new Date().toISOString() })
    .eq('cuenta_id', cuenta_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/tesoreria')
  return { ok: true }
}

export async function restaurarCuenta(cuenta_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const { error } = await createAdminClient()
    .from('cuentas')
    .update({ activa: true, updated_at: new Date().toISOString() })
    .eq('cuenta_id', cuenta_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/tesoreria')
  return { ok: true }
}

// ── Registrar movimiento manual (INGRESO / EGRESO) ─────────────────────────────

export async function registrarMovimiento(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const cuenta_id = (formData.get('cuenta_id') as string)?.trim()
  const tipo      = (formData.get('tipo')      as string)?.trim() as TipoMovimiento
  const montoRaw  = parseFloat(formData.get('monto') as string)
  const fecha     = (formData.get('fecha')     as string)?.trim()
  const concepto  = (formData.get('concepto')  as string)?.trim()
  const categoria = (formData.get('categoria') as string)?.trim() || null
  const notas     = (formData.get('notas')     as string)?.trim() || null

  if (!cuenta_id)                          return { ok: false, error: 'Debes seleccionar una cuenta.' }
  if (!TIPOS_MOVIMIENTO.includes(tipo))    return { ok: false, error: 'Tipo de movimiento no válido.' }
  if (isNaN(montoRaw) || montoRaw <= 0)    return { ok: false, error: 'El monto debe ser un número positivo.' }
  if (!concepto)                           return { ok: false, error: 'El concepto es obligatorio.' }

  // Verificar la cuenta y heredar empresa + moneda
  const { data: cuenta } = await db.from('cuentas')
    .select('empresa_id, moneda, activa')
    .eq('cuenta_id', cuenta_id)
    .eq('client_id', session.client_id)
    .single()
  if (!cuenta)        return { ok: false, error: 'Cuenta no encontrada.' }
  if (!cuenta.activa) return { ok: false, error: 'La cuenta está archivada.' }

  const { error } = await db.from('movimientos_tesoreria').insert({
    movimiento_id: generarMovimientoId(),
    client_id:     session.client_id,
    empresa_id:    cuenta.empresa_id,
    cuenta_id,
    fecha:         fecha || new Date().toISOString().split('T')[0],
    tipo,
    monto:         montoRaw,
    moneda:        cuenta.moneda,
    concepto,
    categoria,
    origen:        'MANUAL',
    notas,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/tesoreria')
  return { ok: true }
}

// ── Registrar transferencia entre cuentas (misma moneda) ───────────────────────
// Crea dos movimientos agrupados por transfer_grupo: EGRESO en origen + INGRESO en destino.

export async function registrarTransferencia(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const cuenta_origen  = (formData.get('cuenta_origen')  as string)?.trim()
  const cuenta_destino = (formData.get('cuenta_destino') as string)?.trim()
  const montoRaw       = parseFloat(formData.get('monto') as string)
  const fecha          = (formData.get('fecha')    as string)?.trim()
  const concepto       = (formData.get('concepto') as string)?.trim() || 'Transferencia entre cuentas'
  const notas          = (formData.get('notas')    as string)?.trim() || null

  if (!cuenta_origen || !cuenta_destino) return { ok: false, error: 'Debes seleccionar cuenta origen y destino.' }
  if (cuenta_origen === cuenta_destino)  return { ok: false, error: 'El origen y el destino deben ser distintos.' }
  if (isNaN(montoRaw) || montoRaw <= 0)  return { ok: false, error: 'El monto debe ser un número positivo.' }

  const { data: cuentas } = await db.from('cuentas')
    .select('cuenta_id, nombre, empresa_id, moneda, activa')
    .eq('client_id', session.client_id)
    .in('cuenta_id', [cuenta_origen, cuenta_destino])

  const origen  = cuentas?.find(c => c.cuenta_id === cuenta_origen)
  const destino = cuentas?.find(c => c.cuenta_id === cuenta_destino)
  if (!origen || !destino)             return { ok: false, error: 'Cuenta no encontrada.' }
  if (!origen.activa || !destino.activa) return { ok: false, error: 'Ambas cuentas deben estar activas.' }
  if (origen.moneda !== destino.moneda) {
    return { ok: false, error: 'Por ahora solo se permiten transferencias entre cuentas de la misma moneda.' }
  }

  const grupo     = `TRF-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
  const fechaFinal = fecha || new Date().toISOString().split('T')[0]

  const { error } = await db.from('movimientos_tesoreria').insert([
    {
      movimiento_id: generarMovimientoId(),
      client_id:     session.client_id,
      empresa_id:    origen.empresa_id,
      cuenta_id:     origen.cuenta_id,
      fecha:         fechaFinal,
      tipo:          'EGRESO',
      monto:         montoRaw,
      moneda:        origen.moneda,
      concepto:      `${concepto} → ${destino.nombre}`,
      origen:        'TRANSFERENCIA',
      transfer_grupo: grupo,
      notas,
    },
    {
      movimiento_id: generarMovimientoId(),
      client_id:     session.client_id,
      empresa_id:    destino.empresa_id,
      cuenta_id:     destino.cuenta_id,
      fecha:         fechaFinal,
      tipo:          'INGRESO',
      monto:         montoRaw,
      moneda:        destino.moneda,
      concepto:      `${concepto} ← ${origen.nombre}`,
      origen:        'TRANSFERENCIA',
      transfer_grupo: grupo,
      notas,
    },
  ])
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/tesoreria')
  return { ok: true }
}

// ── Eliminar movimiento ────────────────────────────────────────────────────────
// Si forma parte de una transferencia, elimina ambas patas (por transfer_grupo).
// Solo se permite borrar movimientos manuales o de transferencia (no cobros/pagos:
// esos se revierten desde su documento en las tandas siguientes).

export async function eliminarMovimiento(movimiento_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const { data: mov } = await db.from('movimientos_tesoreria')
    .select('origen, transfer_grupo')
    .eq('movimiento_id', movimiento_id)
    .eq('client_id', session.client_id)
    .single()
  if (!mov) return { ok: false, error: 'Movimiento no encontrado.' }

  if (mov.origen === 'COBRO' || mov.origen === 'PAGO') {
    return { ok: false, error: 'Este movimiento proviene de un cobro o pago. Anúlalo desde su documento.' }
  }

  const query = db.from('movimientos_tesoreria').delete().eq('client_id', session.client_id)
  const { error } = mov.transfer_grupo
    ? await query.eq('transfer_grupo', mov.transfer_grupo)   // borra ambas patas
    : await query.eq('movimiento_id', movimiento_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/tesoreria')
  return { ok: true }
}
