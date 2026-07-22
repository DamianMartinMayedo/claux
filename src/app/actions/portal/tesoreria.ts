'use server'

import { revalidatePath }    from 'next/cache'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { type CategoriaGasto } from './gastos'
import { monedaValida }      from '@/lib/tasas'
import { generarCuentaId, generarMovimientoId } from '@/lib/tesoreria-core'
import { generarRegistroId } from '@/lib/gastos-core'

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
  categoria:      string | null  // Nombre de categoría (para display)
  categoria_id:   string | null  // FK a categorias_gastos
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
  cuentas:           CuentaConSaldo[]
  movimientos:       Movimiento[]
  saldos_por_moneda: { moneda: string; saldo: number }[]
  empresa_nombres:   Record<string, string>
  empresas:          { empresa_id: string; nombre: string }[]
  monedas:           string[]   // códigos de monedas activas
  categorias_gastos: CategoriaGasto[]  // Para selects de categoría
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Los generadores viven en los núcleos compartidos con el importador
// (`@/lib/tesoreria-core`, `@/lib/gastos-core`): un código de negocio no puede
// tener tres copias del mismo generador repartidas por el portal.

const TIPOS_CUENTA:     TipoCuenta[]     = ['CAJA', 'BANCO', 'PASARELA', 'OTRO']
const TIPOS_MOVIMIENTO: TipoMovimiento[] = ['INGRESO', 'EGRESO']

// ── Obtener tesorería (cuentas + movimientos + saldos) ─────────────────────────

export async function obtenerTesoreria(): Promise<TesoreriaPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)

  const [cuRes, movRes, monRes, catRes] = await Promise.all([
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
    db.from('categorias_gastos').select('*')
      .eq('client_id', session.client_id)
      .eq('estado', 'ACTIVO')
      .order('nombre'),
  ])

  // Las cuentas de «Apertura» (mig. 130) NO son dinero real: son el contrapeso
  // técnico contra el que el importador salda el histórico ya pagado. Ni ellas ni
  // sus movimientos entran en Tesorería — enseñarlas sería inventar caja.
  const todasCuentas = (cuRes.data ?? []) as (Cuenta & { es_apertura?: boolean })[]
  const idsApertura  = new Set(todasCuentas.filter(c => c.es_apertura).map(c => c.cuenta_id))
  const cuentas      = todasCuentas.filter(c => !c.es_apertura) as Cuenta[]
  const movimientos  = ((movRes.data ?? []) as Movimiento[]).filter(m => !idsApertura.has(m.cuenta_id))

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
    categorias_gastos: (catRes.data ?? []) as CategoriaGasto[],
  }
}

// ── Guardar cuenta (crear / editar) ────────────────────────────────────────────

export async function guardarCuenta(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  // La moneda solo se fija al crear; al editar no se cambia (los movimientos
  // quedarían inconsistentes) y el campo va deshabilitado, así que no se exige.
  if (!cuenta_id && !moneda)            return { ok: false, error: 'Debes seleccionar una moneda.' }
  if (!TIPOS_CUENTA.includes(tipo))     return { ok: false, error: 'Tipo de cuenta no válido.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  if (!cuenta_id) {
    // Crear
    if (!await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
    }
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
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const { error } = await createAdminClient()
    .from('cuentas')
    .update({ activa: true, updated_at: new Date().toISOString() })
    .eq('cuenta_id', cuenta_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/tesoreria')
  return { ok: true }
}

// ── Archivar / restaurar cuentas en lote (Fase 1) ───────────────────────────────
// Candado `base` inline (audit-gating). UPDATE atómico de `activa`. No hay borrado:
// una cuenta con movimientos se archiva, nunca se elimina.

export interface ResultadoLoteCuentas { ok: boolean; hechas: number; error?: string }

export async function archivarCuentasEnLote(
  ids: string[], archivar: boolean,
): Promise<ResultadoLoteCuentas> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, hechas: 0, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, hechas: 0, error: 'No tienes permiso para editar en este módulo.' }
  if (!ids.length) return { ok: true, hechas: 0 }

  const { data, error } = await createAdminClient().from('cuentas')
    .update({ activa: !archivar, updated_at: new Date().toISOString() })
    .eq('client_id', session.client_id).in('cuenta_id', ids)
    .select('cuenta_id')
  if (error) return { ok: false, hechas: 0, error: error.message }
  revalidatePath('/portal/tesoreria')
  return { ok: true, hechas: (data ?? []).length }
}

// ── Registrar movimiento manual (INGRESO / EGRESO) ─────────────────────────────
// Si registrar_gasto está activo, crea también un gasto_cobro vinculado
// (GASTO si es EGRESO, COBRO si es INGRESO) y el movimiento queda con
// origen PAGO/COBRO y referencia_id al registro creado.

export async function registrarMovimiento(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const cuenta_id      = (formData.get('cuenta_id') as string)?.trim()
  const tipo           = (formData.get('tipo')      as string)?.trim() as TipoMovimiento
  const montoRaw       = parseFloat(formData.get('monto') as string)
  const fecha          = (formData.get('fecha')     as string)?.trim()
  const concepto       = (formData.get('concepto')  as string)?.trim()
  const categoria_id   = (formData.get('categoria_id') as string)?.trim() || null
  const notas          = (formData.get('notas')     as string)?.trim() || null
  const registrarGasto = formData.get('registrar_gasto') === 'true'
  const tercero_id     = (formData.get('tercero_id') as string)?.trim() || null

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

  // Obtener nombre de categoría si se proporciona categoria_id
  let categoriaNombre: string | null = null
  if (categoria_id) {
    const { data: cat } = await db.from('categorias_gastos')
      .select('nombre')
      .eq('categoria_id', categoria_id)
      .eq('client_id', session.client_id)
      .eq('estado', 'ACTIVO')
      .maybeSingle()
    if (!cat) return { ok: false, error: 'Categoría de gasto no válida o inactiva.' }
    categoriaNombre = cat.nombre
  }

  let gastoId: string | null = null
  const fechaFinal = fecha || new Date().toISOString().split('T')[0]

  if (registrarGasto) {
    const esGasto = tipo === 'EGRESO'
    gastoId = generarRegistroId(esGasto ? 'GASTO' : 'COBRO')
    const { error: gcErr } = await db.from('gastos_cobros').insert({
      registro_id:  gastoId,
      client_id:    session.client_id,
      empresa_id:   cuenta.empresa_id,
      tipo:         esGasto ? 'GASTO' : 'COBRO',
      fecha:        fechaFinal,
      descripcion:  concepto,
      categoria:    categoriaNombre,
      categoria_id,
      moneda:       cuenta.moneda,
      monto:        montoRaw,
      tercero_id:   tercero_id,
      notas,
      updated_at:   new Date().toISOString(),
    })
    if (gcErr) return { ok: false, error: `Error al crear el registro: ${gcErr.message}` }
  }

  const { error } = await db.from('movimientos_tesoreria').insert({
    movimiento_id: generarMovimientoId(),
    client_id:     session.client_id,
    empresa_id:    cuenta.empresa_id,
    cuenta_id,
    fecha:         fechaFinal,
    tipo,
    monto:         montoRaw,
    moneda:        cuenta.moneda,
    monto_ref:     montoRaw,   // gasto/cobro creado en la misma moneda de la caja
    concepto,
    categoria:     categoriaNombre,
    categoria_id,
    origen:        registrarGasto ? (tipo === 'EGRESO' ? 'PAGO' : 'COBRO') : 'MANUAL',
    referencia_id: gastoId,
    notas,
  })
  if (error) {
    if (gastoId) {
      await db.from('gastos_cobros').delete().eq('registro_id', gastoId).eq('client_id', session.client_id)
    }
    return { ok: false, error: error.message }
  }

  revalidatePath('/portal/tesoreria')
  if (registrarGasto) {
    revalidatePath('/portal/gastos')
    revalidatePath('/portal/cxp')
    revalidatePath('/portal/cxc')
    revalidarFinanzas()
  }
  return { ok: true }
}

// ── Obtener tasa vigente para transferencia entre monedas ─────────────────────
// Busca tasa directa (origen→destino). Si no existe, calcula la inversa (destino→origen).
// Devuelve tasa completa para cálculos y tasaDisplay truncada a 4 decimales para UI.

export async function obtenerTasaTransferencia(
  moneda_origen: string,
  moneda_destino: string,
): Promise<{ ok: boolean; tasa?: number; tasaDisplay?: number; fecha?: string; esInversa?: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

  if (moneda_origen === moneda_destino) {
    return { ok: true, tasa: 1, tasaDisplay: 1, fecha: new Date().toISOString().split('T')[0] }
  }

  const db = createAdminClient()

  const { data: directa } = await db.from('tasas_cambio')
    .select('tasa, fecha')
    .eq('client_id', session.client_id)
    .eq('moneda_origen', moneda_origen)
    .eq('moneda_destino', moneda_destino)
    .order('fecha', { ascending: false })
    .order('tasa_id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (directa) {
    const tasaCompleta = Number(directa.tasa)
    return { ok: true, tasa: tasaCompleta, tasaDisplay: Math.trunc(tasaCompleta * 10000) / 10000, fecha: directa.fecha, esInversa: false }
  }

  const { data: inversa } = await db.from('tasas_cambio')
    .select('tasa, fecha')
    .eq('client_id', session.client_id)
    .eq('moneda_origen', moneda_destino)
    .eq('moneda_destino', moneda_origen)
    .order('fecha', { ascending: false })
    .order('tasa_id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (inversa && Number(inversa.tasa) > 0) {
    const tasaCompleta = 1 / Number(inversa.tasa)
    return { ok: true, tasa: tasaCompleta, tasaDisplay: Math.trunc(tasaCompleta * 10000) / 10000, fecha: inversa.fecha, esInversa: true }
  }

  return { ok: false, error: `Sin tasa registrada para ${moneda_origen} → ${moneda_destino}.` }
}

// ── Registrar transferencia entre cuentas (misma o diferente moneda) ───────────
// Crea movimientos agrupados por transfer_grupo:
//   - EGRESO en origen (monto principal)
//   - INGRESO en destino (monto × tasa)
//   - Si fee_envio > 0: gasto_cobros + EGRESO en origen
//   - Si fee_recibo > 0: gasto_cobros + EGRESO en destino

export async function registrarTransferencia(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const cuenta_origen  = (formData.get('cuenta_origen')  as string)?.trim()
  const cuenta_destino = (formData.get('cuenta_destino') as string)?.trim()
  const montoRaw       = parseFloat(formData.get('monto') as string)
  const fecha          = (formData.get('fecha')    as string)?.trim()
  const concepto       = (formData.get('concepto') as string)?.trim() || 'Transferencia entre cuentas'
  const notas          = (formData.get('notas')    as string)?.trim() || null
  const tasaRaw        = parseFloat(formData.get('tasa_cambio') as string)
  const feeEnvioRaw    = parseFloat(formData.get('fee_envio') as string)
  const feeReciboRaw   = parseFloat(formData.get('fee_recibo') as string)

  if (!cuenta_origen || !cuenta_destino) return { ok: false, error: 'Debes seleccionar cuenta origen y destino.' }
  if (cuenta_origen === cuenta_destino)  return { ok: false, error: 'El origen y el destino deben ser distintos.' }
  if (isNaN(montoRaw) || montoRaw <= 0)  return { ok: false, error: 'El monto debe ser un número positivo.' }

  const feeEnvio  = isNaN(feeEnvioRaw)  ? 0 : feeEnvioRaw
  const feeRecibo = isNaN(feeReciboRaw) ? 0 : feeReciboRaw

  if (feeEnvio < 0)  return { ok: false, error: 'El fee de envío no puede ser negativo.' }
  if (feeRecibo < 0) return { ok: false, error: 'El fee de recepción no puede ser negativo.' }

  const { data: cuentas } = await db.from('cuentas')
    .select('cuenta_id, nombre, empresa_id, moneda, activa')
    .eq('client_id', session.client_id)
    .in('cuenta_id', [cuenta_origen, cuenta_destino])

  const origen  = cuentas?.find(c => c.cuenta_id === cuenta_origen)
  const destino = cuentas?.find(c => c.cuenta_id === cuenta_destino)
  if (!origen || !destino)               return { ok: false, error: 'Cuenta no encontrada.' }
  if (!origen.activa || !destino.activa) return { ok: false, error: 'Ambas cuentas deben estar activas.' }

  const monedasDiferentes = origen.moneda !== destino.moneda
  let tasa = 1
  let montoDestino = montoRaw

  if (monedasDiferentes) {
    if (isNaN(tasaRaw) || tasaRaw <= 0) {
      return { ok: false, error: 'Debes indicar la tasa de cambio para transferencias entre monedas.' }
    }
    tasa = tasaRaw
    montoDestino = montoRaw * tasa
  }

  // Buscar categoria_id de "Comisiones bancarias" (categoría del sistema)
  const { data: catComisiones } = await db.from('categorias_gastos')
    .select('categoria_id, nombre')
    .eq('client_id', session.client_id)
    .eq('nombre', 'Comisiones bancarias')
    .eq('estado', 'ACTIVO')
    .maybeSingle()
  
  const comisionesCategoriaId = catComisiones?.categoria_id ?? null
  const comisionesNombre = catComisiones?.nombre ?? 'Comisiones bancarias'

  const grupo      = `TRF-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
  const fechaFinal = fecha || new Date().toISOString().split('T')[0]

  const movimientos: Record<string, unknown>[] = [
    {
      movimiento_id: generarMovimientoId(),
      client_id:     session.client_id,
      empresa_id:    origen.empresa_id,
      cuenta_id:     origen.cuenta_id,
      fecha:         fechaFinal,
      tipo:          'EGRESO',
      monto:         montoRaw,
      moneda:        origen.moneda,
      concepto:      monedasDiferentes
        ? `${concepto} → ${destino.nombre} (${tasa} ${destino.moneda}/${origen.moneda})`
        : `${concepto} → ${destino.nombre}`,
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
      monto:         montoDestino,
      moneda:        destino.moneda,
      concepto:      monedasDiferentes
        ? `${concepto} ← ${origen.nombre} (${tasa} ${destino.moneda}/${origen.moneda})`
        : `${concepto} ← ${origen.nombre}`,
      origen:        'TRANSFERENCIA',
      transfer_grupo: grupo,
      notas,
    },
  ]

  const gastosCreados: string[] = []

  if (feeEnvio > 0) {
    const gasto_id = generarRegistroId('GASTO')
    gastosCreados.push(gasto_id)
    const { error } = await db.from('gastos_cobros').insert({
      registro_id:  gasto_id,
      client_id:    session.client_id,
      empresa_id:   origen.empresa_id,
      tipo:         'GASTO',
      fecha:        fechaFinal,
      descripcion:  `Comisión transferencia ${origen.nombre} → ${destino.nombre}`,
      categoria:    comisionesNombre,
      categoria_id: comisionesCategoriaId,
      moneda:       origen.moneda,
      monto:        feeEnvio,
      updated_at:   new Date().toISOString(),
    })
    if (error) return { ok: false, error: `Error al crear gasto de fee envío: ${error.message}` }

    movimientos.push({
      movimiento_id: generarMovimientoId(),
      client_id:     session.client_id,
      empresa_id:    origen.empresa_id,
      cuenta_id:     origen.cuenta_id,
      fecha:         fechaFinal,
      tipo:          'EGRESO',
      monto:         feeEnvio,
      moneda:        origen.moneda,
      monto_ref:     feeEnvio,
      concepto:      `Comisión transferencia → ${destino.nombre}`,
      categoria:     comisionesNombre,
      categoria_id:  comisionesCategoriaId,
      origen:        'PAGO',
      referencia_id: gasto_id,
      transfer_grupo: grupo,
      notas,
    })
  }

  if (feeRecibo > 0) {
    const gasto_id = generarRegistroId('GASTO')
    gastosCreados.push(gasto_id)
    const { error } = await db.from('gastos_cobros').insert({
      registro_id:  gasto_id,
      client_id:    session.client_id,
      empresa_id:   destino.empresa_id,
      tipo:         'GASTO',
      fecha:        fechaFinal,
      descripcion:  `Comisión transferencia ${origen.nombre} → ${destino.nombre}`,
      categoria:    comisionesNombre,
      categoria_id: comisionesCategoriaId,
      moneda:       destino.moneda,
      monto:        feeRecibo,
      updated_at:   new Date().toISOString(),
    })
    if (error) return { ok: false, error: `Error al crear gasto de fee recepción: ${error.message}` }

    movimientos.push({
      movimiento_id: generarMovimientoId(),
      client_id:     session.client_id,
      empresa_id:    destino.empresa_id,
      cuenta_id:     destino.cuenta_id,
      fecha:         fechaFinal,
      tipo:          'EGRESO',
      monto:         feeRecibo,
      moneda:        destino.moneda,
      monto_ref:     feeRecibo,
      concepto:      `Comisión transferencia ← ${origen.nombre}`,
      categoria:     comisionesNombre,
      categoria_id:  comisionesCategoriaId,
      origen:        'PAGO',
      referencia_id: gasto_id,
      transfer_grupo: grupo,
      notas,
    })
  }

  const { error } = await db.from('movimientos_tesoreria').insert(movimientos)
  if (error) {
    for (const gid of gastosCreados) {
      await db.from('gastos_cobros').delete().eq('registro_id', gid).eq('client_id', session.client_id)
    }
    return { ok: false, error: error.message }
  }

  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidarFinanzas()
  return { ok: true }
}

// ── Eliminar movimiento ────────────────────────────────────────────────────────
// Si forma parte de una transferencia, elimina todas las patas (por transfer_grupo)
// y los gastos_cobros asociados a fees.
// Solo se permite borrar movimientos manuales o de transferencia (no cobros/pagos
// independientes: esos se revierten desde Gastos y cobros).

export async function eliminarMovimiento(movimiento_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { data: mov } = await db.from('movimientos_tesoreria')
    .select('origen, transfer_grupo')
    .eq('movimiento_id', movimiento_id)
    .eq('client_id', session.client_id)
    .single()
  if (!mov) return { ok: false, error: 'Movimiento no encontrado.' }

  if (!mov.transfer_grupo) {
    if (mov.origen === 'COBRO' || mov.origen === 'PAGO') {
      return { ok: false, error: 'Este movimiento proviene de un cobro o pago. Anúlalo desde su documento.' }
    }
    const { error } = await db.from('movimientos_tesoreria')
      .delete()
      .eq('movimiento_id', movimiento_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/portal/tesoreria')
    return { ok: true }
  }

  const { data: grupoMovs } = await db.from('movimientos_tesoreria')
    .select('movimiento_id, origen, referencia_id')
    .eq('client_id', session.client_id)
    .eq('transfer_grupo', mov.transfer_grupo)

  const gastoIds = (grupoMovs ?? [])
    .filter(m => m.origen === 'PAGO' && m.referencia_id)
    .map(m => m.referencia_id)

  if (gastoIds.length > 0) {
    await db.from('gastos_cobros')
      .delete()
      .eq('client_id', session.client_id)
      .in('registro_id', gastoIds)
  }

  const { error } = await db.from('movimientos_tesoreria')
    .delete()
    .eq('client_id', session.client_id)
    .eq('transfer_grupo', mov.transfer_grupo)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidarFinanzas()
  return { ok: true }
}

// ── Eliminar movimientos en lote (Fase 2) ───────────────────────────────────────
// Candado `base` inline (audit-gating). Solo son elegibles los MANUALES sin
// transfer_grupo: reutiliza la guarda de eliminarMovimiento en bucle secuencial.
// Los provenientes de cobro/pago o de transferencias se OMITEN con su motivo (no
// se borran a ciegas: descuadran saldos y estados derivados).

export interface ResultadoLoteMovimientos {
  ok: boolean
  hechas: number
  omitidas: { concepto: string; motivo: string }[]
  error?: string
}

export async function eliminarMovimientosEnLote(ids: string[]): Promise<ResultadoLoteMovimientos> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, hechas: 0, omitidas: [], error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, hechas: 0, omitidas: [], error: 'No tienes permiso para editar en este módulo.' }
  if (!ids.length) return { ok: true, hechas: 0, omitidas: [] }

  const db = createAdminClient()
  const { data: movs } = await db.from('movimientos_tesoreria')
    .select('movimiento_id, concepto, origen, transfer_grupo')
    .eq('client_id', session.client_id).in('movimiento_id', ids)

  const res: ResultadoLoteMovimientos = { ok: true, hechas: 0, omitidas: [] }
  for (const m of (movs ?? []) as { movimiento_id: string; concepto: string; origen: string; transfer_grupo: string | null }[]) {
    if (m.transfer_grupo) {
      res.omitidas.push({ concepto: m.concepto, motivo: 'es una transferencia (elimínala desde su detalle)' }); continue
    }
    if (m.origen !== 'MANUAL') {
      res.omitidas.push({ concepto: m.concepto, motivo: 'proviene de un cobro o pago (anúlalo desde su documento)' }); continue
    }
    const r = await eliminarMovimiento(m.movimiento_id)   // secuencial; conserva la guarda individual
    if (r.ok) res.hechas++
    else res.omitidas.push({ concepto: m.concepto, motivo: r.error ?? 'No se pudo eliminar' })
  }
  revalidatePath('/portal/tesoreria')
  return res
}
