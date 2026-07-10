'use server'

import { revalidatePath }    from 'next/cache'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type ModoCuentas = 'COBRAR' | 'PAGAR'
export type DocTipo      = 'FACTURA' | 'REGISTRO'
export type Tramo        = 'AL_DIA' | 'V_1_30' | 'V_31_60' | 'V_60'

export interface LiquidacionDoc {
  movimiento_id: string
  fecha:         string
  monto:         number
  cuenta_nombre: string
}

export interface DocumentoPendiente {
  doc_tipo:       DocTipo
  doc_id:         string
  numero:         string            // nº de factura o descripción del registro
  tercero_nombre: string | null
  empresa_id:     string
  fecha:          string
  vencimiento:    string | null
  moneda:         string
  monto:          number
  liquidado:      number
  saldo:          number
  dias_vencido:   number | null     // >0 si está vencido; null si al día / sin fecha
  tramo:          Tramo
  ref_url:        string | null     // enlace al documento (facturas)
  liquidaciones:  LiquidacionDoc[]
}

export interface CuentasPageData {
  modo:            ModoCuentas
  documentos:      DocumentoPendiente[]
  cuentas:         { cuenta_id: string; nombre: string; empresa_id: string; moneda: string }[]
  empresa_nombres: Record<string, string>
  empresas:        { empresa_id: string; nombre: string }[]
}

const EPS = 0.005

// ── Helpers ───────────────────────────────────────────────────────────────────

function generarMovimientoId(): string {
  return `MOV-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
function hoyISO(): string { return new Date().toISOString().split('T')[0] }

function diasEntre(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split('T')[0].split('-').map(Number)
  const [y2, m2, d2] = hasta.split('T')[0].split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

function tramoDe(vencimiento: string | null, hoy: string): { dias: number | null; tramo: Tramo } {
  if (!vencimiento || vencimiento.split('T')[0] >= hoy) return { dias: null, tramo: 'AL_DIA' }
  const dias = diasEntre(vencimiento, hoy)
  if (dias <= 30) return { dias, tramo: 'V_1_30' }
  if (dias <= 60) return { dias, tramo: 'V_31_60' }
  return { dias, tramo: 'V_60' }
}

// ── Cargar documentos pendientes (compartido por CxC y CxP) ─────────────────────

async function cargarCuentas(modo: ModoCuentas): Promise<CuentasPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']
  const hoy         = hoyISO()

  // Movimientos de liquidación (para saldos e historial) + terceros + cuentas
  const [movRes, terRes, cuRes] = await Promise.all([
    db.from('movimientos_tesoreria')
      .select('movimiento_id, fecha, monto, monto_ref, cuenta_id, referencia_id')
      .eq('client_id', session.client_id)
      .in('origen', ['PAGO', 'COBRO'])
      .not('referencia_id', 'is', null),
    db.from('third_parties').select('tercero_id, nombre')
      .eq('client_id', session.client_id),
    db.from('cuentas').select('cuenta_id, nombre, empresa_id, moneda, activa')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('nombre'),
  ])

  const cuentaNombre: Record<string, string> = {}
  for (const c of (cuRes.data ?? []) as { cuenta_id: string; nombre: string }[]) cuentaNombre[c.cuenta_id] = c.nombre

  const liquidadoPorDoc = new Map<string, number>()
  const liqsPorDoc      = new Map<string, LiquidacionDoc[]>()
  for (const m of (movRes.data ?? []) as { movimiento_id: string; fecha: string; monto: number; monto_ref: number | null; cuenta_id: string; referencia_id: string }[]) {
    // El saldo del documento se mide en su propia moneda → monto_ref (importe aplicado)
    const aplicado = Number(m.monto_ref ?? m.monto)
    liquidadoPorDoc.set(m.referencia_id, (liquidadoPorDoc.get(m.referencia_id) ?? 0) + aplicado)
    const arr = liqsPorDoc.get(m.referencia_id) ?? []
    arr.push({ movimiento_id: m.movimiento_id, fecha: m.fecha, monto: aplicado, cuenta_nombre: cuentaNombre[m.cuenta_id] ?? m.cuenta_id })
    liqsPorDoc.set(m.referencia_id, arr)
  }
  const terceroNombre: Record<string, string> = {}
  for (const t of (terRes.data ?? []) as { tercero_id: string; nombre: string }[]) terceroNombre[t.tercero_id] = t.nombre

  const documentos: DocumentoPendiente[] = []

  if (modo === 'COBRAR') {
    // Facturas emitidas (formalmente cobrables)
    const { data: facturas } = await db.from('facturas')
      .select('factura_id, numero, empresa_id, cliente_id, fecha_emision, fecha_vencimiento, moneda, total, estado')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .eq('estado', 'EMITIDA')
    for (const f of (facturas ?? []) as Record<string, unknown>[]) {
      const monto     = Number(f.total)
      const liquidado = liquidadoPorDoc.get(f.factura_id as string) ?? 0
      const saldo     = monto - liquidado
      if (saldo <= EPS) continue
      const { dias, tramo } = tramoDe(f.fecha_vencimiento as string | null, hoy)
      documentos.push({
        doc_tipo: 'FACTURA', doc_id: f.factura_id as string, numero: f.numero as string,
        tercero_nombre: terceroNombre[f.cliente_id as string] ?? null,
        empresa_id: f.empresa_id as string, fecha: f.fecha_emision as string,
        vencimiento: (f.fecha_vencimiento as string | null) ?? null,
        moneda: f.moneda as string, monto, liquidado, saldo,
        dias_vencido: dias, tramo, ref_url: `/portal/ventas/facturas/${f.factura_id}`,
        liquidaciones: liqsPorDoc.get(f.factura_id as string) ?? [],
      })
    }
  }

  // Registros de gastos_cobros (COBRO para CxC, GASTO para CxP)
  const tipoRegistro = modo === 'COBRAR' ? 'COBRO' : 'GASTO'
  const { data: registros } = await db.from('gastos_cobros')
    .select('registro_id, descripcion, empresa_id, tercero_id, fecha, vencimiento, moneda, monto')
    .eq('client_id', session.client_id)
    .in('empresa_id', idsFiltro)
    .eq('tipo', tipoRegistro)
  for (const r of (registros ?? []) as Record<string, unknown>[]) {
    const monto     = Number(r.monto)
    const liquidado = liquidadoPorDoc.get(r.registro_id as string) ?? 0
    const saldo     = monto - liquidado
    if (saldo <= EPS) continue
    const { dias, tramo } = tramoDe(r.vencimiento as string | null, hoy)
    documentos.push({
      doc_tipo: 'REGISTRO', doc_id: r.registro_id as string, numero: r.descripcion as string,
      tercero_nombre: r.tercero_id ? (terceroNombre[r.tercero_id as string] ?? null) : null,
      empresa_id: r.empresa_id as string, fecha: r.fecha as string,
      vencimiento: (r.vencimiento as string | null) ?? null,
      moneda: r.moneda as string, monto, liquidado, saldo,
      dias_vencido: dias, tramo, ref_url: '/portal/gastos',
      liquidaciones: liqsPorDoc.get(r.registro_id as string) ?? [],
    })
  }

  // Orden: primero los más vencidos, luego por vencimiento ascendente
  documentos.sort((a, b) => (b.dias_vencido ?? -1) - (a.dias_vencido ?? -1))

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  return {
    modo,
    documentos,
    cuentas:         (cuRes.data ?? [])
                       .filter((c: Record<string, unknown>) => c.activa)
                       .map((c: Record<string, unknown>) => ({
                         cuenta_id: c.cuenta_id as string, nombre: c.nombre as string,
                         empresa_id: c.empresa_id as string, moneda: c.moneda as string,
                       })),
    empresa_nombres,
    empresas:        empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
  }
}

export async function obtenerCuentasPorCobrar(): Promise<CuentasPageData | null> { return cargarCuentas('COBRAR') }
export async function obtenerCuentasPorPagar():  Promise<CuentasPageData | null> { return cargarCuentas('PAGAR') }

// ── Cobros de una factura (para el panel en el detalle de factura) ──────────────

export interface CobrosFacturaData {
  factura_id:    string
  moneda:        string
  total:         number
  liquidado:     number
  saldo:         number
  estado:        string
  liquidaciones: LiquidacionDoc[]
  cuentas:       { cuenta_id: string; nombre: string; moneda: string }[]
}

export async function obtenerCobrosFactura(factura_id: string): Promise<CobrosFacturaData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const { data: factura } = await db.from('facturas')
    .select('moneda, total, estado, empresa_id')
    .eq('factura_id', factura_id).eq('client_id', session.client_id).maybeSingle()
  if (!factura) return null

  const [movRes, cuRes] = await Promise.all([
    db.from('movimientos_tesoreria')
      .select('movimiento_id, fecha, monto, monto_ref, cuenta_id')
      .eq('client_id', session.client_id)
      .eq('referencia_id', factura_id)
      .in('origen', ['COBRO', 'PAGO']),
    db.from('cuentas').select('cuenta_id, nombre, moneda')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('nombre'),
  ])

  const cuentaNombre: Record<string, string> = {}
  for (const c of (cuRes.data ?? []) as { cuenta_id: string; nombre: string }[]) cuentaNombre[c.cuenta_id] = c.nombre

  // monto_ref = importe aplicado a la factura en su moneda (reconcilia el saldo)
  const liquidaciones: LiquidacionDoc[] = ((movRes.data ?? []) as { movimiento_id: string; fecha: string; monto: number; monto_ref: number | null; cuenta_id: string }[])
    .map(m => ({ movimiento_id: m.movimiento_id, fecha: m.fecha, monto: Number(m.monto_ref ?? m.monto), cuenta_nombre: cuentaNombre[m.cuenta_id] ?? m.cuenta_id }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))

  const total     = Number(factura.total)
  const liquidado = liquidaciones.reduce((s, l) => s + l.monto, 0)

  return {
    factura_id,
    moneda:    factura.moneda,
    total,
    liquidado,
    saldo:     Math.max(0, total - liquidado),
    estado:    factura.estado,
    liquidaciones,
    cuentas:   (cuRes.data ?? []) as { cuenta_id: string; nombre: string; moneda: string }[],
  }
}

// ── Registrar cobro / pago de un documento (factura o registro) ─────────────────
// Crea un movimiento de Tesorería (origen COBRO/PAGO). Admite pagos parciales.
// Si una factura queda saldada → estado COBRADA.

export async function registrarPagoDoc(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const doc_tipo  = (formData.get('doc_tipo')  as string)?.trim() as DocTipo
  const doc_id    = (formData.get('doc_id')    as string)?.trim()
  const cuenta_id = (formData.get('cuenta_id') as string)?.trim()
  const montoRaw  = parseFloat(formData.get('monto') as string)   // en la moneda del documento
  const tasaRaw   = parseFloat(formData.get('tasa_cambio') as string)
  const fecha     = (formData.get('fecha')     as string)?.trim() || hoyISO()
  const notas     = (formData.get('notas')     as string)?.trim() || null

  if (doc_tipo !== 'FACTURA' && doc_tipo !== 'REGISTRO') return { ok: false, error: 'Documento no válido.' }
  if (!doc_id)                          return { ok: false, error: 'Documento no válido.' }
  if (!cuenta_id)                       return { ok: false, error: 'Debes seleccionar una cuenta.' }
  if (isNaN(montoRaw) || montoRaw <= 0) return { ok: false, error: 'El monto debe ser un número positivo.' }

  // Datos del documento (monto, moneda, sentido, concepto)
  let monto = 0, moneda = '', esIngreso = true, concepto = ''
  if (doc_tipo === 'FACTURA') {
    const { data: f } = await db.from('facturas')
      .select('numero, moneda, total, estado')
      .eq('factura_id', doc_id).eq('client_id', session.client_id).single()
    if (!f)                      return { ok: false, error: 'Factura no encontrada.' }
    if (f.estado !== 'EMITIDA')  return { ok: false, error: 'Solo se cobran facturas emitidas.' }
    monto = Number(f.total); moneda = f.moneda; esIngreso = true
    concepto = `Cobro factura ${f.numero}`
  } else {
    const { data: r } = await db.from('gastos_cobros')
      .select('tipo, descripcion, moneda, monto, categoria')
      .eq('registro_id', doc_id).eq('client_id', session.client_id).single()
    if (!r) return { ok: false, error: 'Registro no encontrado.' }
    monto = Number(r.monto); moneda = r.moneda; esIngreso = r.tipo === 'COBRO'
    concepto = `${esIngreso ? 'Cobro' : 'Pago'} · ${r.descripcion}`
  }

  // Cuenta destino/origen
  const { data: cuenta } = await db.from('cuentas')
    .select('empresa_id, moneda, activa')
    .eq('cuenta_id', cuenta_id).eq('client_id', session.client_id).single()
  if (!cuenta)        return { ok: false, error: 'Cuenta no encontrada.' }
  if (!cuenta.activa) return { ok: false, error: 'La cuenta está archivada.' }

  // Moneda distinta a la del documento → se aplica tasa (misma lógica que las transferencias).
  // `montoRaw` es siempre el importe en la moneda del documento (lo que reduce su saldo);
  // en la caja entra/sale `montoCaja` = montoRaw × tasa, en la moneda de la caja.
  const cambiaMoneda = cuenta.moneda !== moneda
  const tasa = cambiaMoneda ? tasaRaw : 1
  if (cambiaMoneda && (isNaN(tasa) || tasa <= 0)) {
    return { ok: false, error: `Indica la tasa de cambio para saldar en ${moneda} desde una caja en ${cuenta.moneda}.` }
  }
  const montoCaja = Math.round(montoRaw * tasa * 100) / 100

  // Saldo pendiente (en la moneda del documento → se suma monto_ref)
  const { data: liqs } = await db.from('movimientos_tesoreria')
    .select('monto_ref, monto').eq('client_id', session.client_id).eq('referencia_id', doc_id)
  const yaLiquidado = (liqs ?? []).reduce((s, m) => s + Number(m.monto_ref ?? m.monto), 0)
  const pendiente   = monto - yaLiquidado
  if (montoRaw > pendiente + EPS) {
    return { ok: false, error: `El monto supera el saldo pendiente (${pendiente.toFixed(2)} ${moneda}).` }
  }

  const { error } = await db.from('movimientos_tesoreria').insert({
    movimiento_id: generarMovimientoId(),
    client_id:     session.client_id,
    empresa_id:    cuenta.empresa_id,
    cuenta_id,
    fecha,
    tipo:          esIngreso ? 'INGRESO' : 'EGRESO',
    monto:         montoCaja,       // en la moneda de la caja
    moneda:        cuenta.moneda,
    monto_ref:     montoRaw,        // en la moneda del documento (reduce su saldo)
    concepto:      cambiaMoneda ? `${concepto} (${montoRaw.toFixed(2)} ${moneda} a ${tasa} ${cuenta.moneda}/${moneda})` : concepto,
    origen:        esIngreso ? 'COBRO' : 'PAGO',
    referencia_id: doc_id,
    notas,
  })
  if (error) return { ok: false, error: error.message }

  // Factura saldada → COBRADA
  if (doc_tipo === 'FACTURA' && montoRaw >= pendiente - EPS) {
    await db.from('facturas')
      .update({ estado: 'COBRADA', updated_at: new Date().toISOString() })
      .eq('factura_id', doc_id).eq('client_id', session.client_id)
    revalidatePath(`/portal/ventas/facturas/${doc_id}`)
    revalidatePath('/portal/ventas')
  }

  revalidatePath('/portal/cxc')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/tesoreria')
  revalidarFinanzas()
  return { ok: true }
}

// ── Anular un cobro / pago ──────────────────────────────────────────────────────
// Borra el movimiento de Tesorería; si la factura estaba COBRADA, vuelve a EMITIDA.

export async function anularPagoDoc(movimiento_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const { data: mov } = await db.from('movimientos_tesoreria')
    .select('origen, referencia_id')
    .eq('movimiento_id', movimiento_id).eq('client_id', session.client_id).single()
  if (!mov) return { ok: false, error: 'Movimiento no encontrado.' }
  if (mov.origen !== 'PAGO' && mov.origen !== 'COBRO') {
    return { ok: false, error: 'Ese movimiento no es un cobro ni un pago.' }
  }

  const { error } = await db.from('movimientos_tesoreria').delete()
    .eq('movimiento_id', movimiento_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  // Si referenciaba una factura COBRADA → revertir a EMITIDA (ya no está saldada)
  if (mov.referencia_id) {
    const { data: f } = await db.from('facturas')
      .select('estado').eq('factura_id', mov.referencia_id).eq('client_id', session.client_id).maybeSingle()
    if (f?.estado === 'COBRADA') {
      await db.from('facturas')
        .update({ estado: 'EMITIDA', updated_at: new Date().toISOString() })
        .eq('factura_id', mov.referencia_id).eq('client_id', session.client_id)
      revalidatePath(`/portal/ventas/facturas/${mov.referencia_id}`)
      revalidatePath('/portal/ventas')
    }
  }

  revalidatePath('/portal/cxc')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/tesoreria')
  revalidarFinanzas()
  return { ok: true }
}
