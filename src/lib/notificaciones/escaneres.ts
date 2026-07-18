// Escáneres del cron: una función por área de negocio. Cada una recibe los
// tenants que YA tienen el módulo correspondiente y consulta su tabla para todos
// a la vez (nunca una query por cliente).
//
// Contrato de cada escáner:
//  · devuelve cuántas notificaciones creó;
//  · llama a `resolverNotificaciones` con las entidades que HOY siguen cumpliendo
//    la condición, para que lo ya arreglado se archive solo y la bandeja no mienta.

import { createAdminClient } from '@/lib/supabase/admin'
import { fmtFechaEs } from '@/lib/date-utils'
import { obtenerUsoMes } from '@/lib/ia/uso'
import { umbralParaFecha, type Umbral } from './catalogo'
import { crearNotificacion, resolverNotificaciones, type ContextoTenant } from './crear'

type Db = ReturnType<typeof createAdminClient>

const MS_DIA = 86_400_000
/** Una sesión de caja abierta más de esto ya es un olvido, no una jornada larga. */
const HORAS_CAJA_ABIERTA = 18
/** Una reserva sin confirmar tanto tiempo es una respuesta que el cliente no recibe. */
const HORAS_SIN_CONFIRMAR = 12
/** Días del mes a partir de los cuales se espera tener la nómina hecha. */
const DIA_AVISO_NOMINA = 25
/** Un dossier publicado con el snapshot más viejo que esto enseña números rancios. */
const DIAS_DOSSIER_RANCIO = 45

export function diasHasta(fecha: string, hoy: string): number {
  return Math.round((new Date(fecha).getTime() - new Date(hoy).getTime()) / MS_DIA)
}

function horasDesde(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

function dinero(monto: number, moneda: string): string {
  return `${Number(monto).toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${moneda}`
}

/** Agrupa por tenant las entidades que siguen "vivas", para la resolución. */
class Vivas {
  private mapa = new Map<string, string[]>()
  add(clientId: string, entidadId: string) {
    if (!this.mapa.has(clientId)) this.mapa.set(clientId, [])
    this.mapa.get(clientId)!.push(entidadId)
  }
  de(clientId: string): string[] { return this.mapa.get(clientId) ?? [] }
}

// ── Terceros: contratos por vencer ────────────────────────────────────────────
export async function escanearContratosTerceros(
  db: Db, tenants: ContextoTenant[], hoy: string,
): Promise<number> {
  const ids = tenants.map(t => t.clientId)
  if (ids.length === 0) return 0

  const { data, error } = await db
    .from('third_parties')
    .select('tercero_id, client_id, empresa_id, nombre, fecha_fin_contrato')
    .in('client_id', ids)
    .eq('activo', true)
    .not('fecha_fin_contrato', 'is', null)

  if (error) {
    console.error('[notificaciones] escáner de contratos de terceros falló', error.message)
    return 0
  }

  const ctxDe = new Map(tenants.map(t => [t.clientId, t]))
  const vivas = new Vivas()
  let creadas = 0

  for (const t of data ?? []) {
    const dias    = diasHasta(t.fecha_fin_contrato as string, hoy)
    const vencido = dias < 0
    const tipo: 'contrato_tercero_vencido' | 'contrato_tercero_vence' =
      vencido ? 'contrato_tercero_vencido' : 'contrato_tercero_vence'
    const umbral: Umbral | null = vencido ? 'vencido' : umbralParaFecha(tipo, dias)
    if (!umbral) continue

    vivas.add(t.client_id as string, t.tercero_id as string)
    const ok = await crearNotificacion({
      clientId:  t.client_id as string,
      empresaId: t.empresa_id as string | null,
      tipo,
      titulo:    vencido
        ? `Contrato vencido — ${t.nombre}`
        : `Contrato por vencer — ${t.nombre}`,
      cuerpo:    vencido
        ? `El contrato con ${t.nombre} venció el ${fmtFechaEs(t.fecha_fin_contrato as string)}.`
        : `El contrato con ${t.nombre} vence el ${fmtFechaEs(t.fecha_fin_contrato as string)}${dias === 0 ? ' (hoy)' : ` (faltan ${dias} día${dias === 1 ? '' : 's'})`}.`,
      enlace:      `/portal/terceros/${t.tercero_id}`,
      entidadTipo: 'tercero',
      entidadId:   t.tercero_id as string,
      umbral,
      meta:        { fecha_fin_contrato: t.fecha_fin_contrato },
      sustituyeA:  ['contrato_tercero_vence', 'contrato_tercero_vencido'],
    }, ctxDe.get(t.client_id as string))
    if (ok) creadas++
  }

  // Un contrato renovado (o dado de baja) deja de avisar.
  for (const t of tenants) {
    await resolverNotificaciones(
      db, t.clientId,
      ['contrato_tercero_vence', 'contrato_tercero_vencido'],
      'tercero', vivas.de(t.clientId),
    )
  }
  return creadas
}

// ── Finanzas: CxC / CxP ───────────────────────────────────────────────────────
// El saldo de un documento es su monto menos lo ya liquidado en Tesorería
// (movimientos con origen PAGO/COBRO y `referencia_id` al documento), igual que
// en cobranza.ts. Solo se avisa de lo que de verdad queda por cobrar/pagar.
export async function escanearCuentas(
  db: Db, tenants: ContextoTenant[], hoy: string,
): Promise<number> {
  const ids = tenants.map(t => t.clientId)
  if (ids.length === 0) return 0

  const [movRes, facRes, regRes, terRes] = await Promise.all([
    db.from('movimientos_tesoreria').select('client_id, monto, monto_ref, referencia_id')
      .in('client_id', ids).in('origen', ['PAGO', 'COBRO']).not('referencia_id', 'is', null),
    db.from('facturas').select('factura_id, client_id, empresa_id, numero, cliente_id, fecha_vencimiento, moneda, total')
      .in('client_id', ids).eq('estado', 'EMITIDA').not('fecha_vencimiento', 'is', null),
    db.from('gastos_cobros').select('registro_id, client_id, empresa_id, tipo, descripcion, tercero_id, vencimiento, moneda, monto')
      .in('client_id', ids).not('vencimiento', 'is', null),
    db.from('third_parties').select('tercero_id, client_id, nombre').in('client_id', ids),
  ])

  // Liquidado por documento (la referencia es única en todo el tenant).
  const liquidado = new Map<string, number>()
  for (const m of movRes.data ?? []) {
    const id = m.referencia_id as string
    liquidado.set(id, (liquidado.get(id) ?? 0) + Number(m.monto_ref ?? m.monto))
  }
  const nombreTercero = new Map(
    (terRes.data ?? []).map(t => [`${t.client_id}:${t.tercero_id}`, t.nombre as string]),
  )
  const EPS = 0.005
  const ctxDe = new Map(tenants.map(t => [t.clientId, t]))

  let creadas = 0
  const vivasCxc = new Vivas()
  const vivasCxp = new Vivas()

  // 1. Facturas emitidas vencidas → CxC.
  for (const f of facRes.data ?? []) {
    const saldo = Number(f.total) - (liquidado.get(f.factura_id as string) ?? 0)
    if (saldo <= EPS) continue
    if (diasHasta(f.fecha_vencimiento as string, hoy) >= 0) continue

    const cliente = nombreTercero.get(`${f.client_id}:${f.cliente_id}`) ?? 'un cliente'
    vivasCxc.add(f.client_id as string, f.factura_id as string)
    const ok = await crearNotificacion({
      clientId:    f.client_id as string,
      empresaId:   f.empresa_id as string | null,
      tipo:        'cxc_vencida',
      titulo:      `Cobro vencido — ${cliente}`,
      cuerpo:      `Factura ${f.numero}: quedan ${dinero(saldo, f.moneda as string)} por cobrar desde el ${fmtFechaEs(f.fecha_vencimiento as string)}.`,
      enlace:      `/portal/ventas/facturas/${f.factura_id}`,
      entidadTipo: 'documento',
      entidadId:   f.factura_id as string,
      umbral:      'vencido',
    }, ctxDe.get(f.client_id as string))
    if (ok) creadas++
  }

  // 2. Registros de gastos y cobros: GASTO → CxP (con aviso previo), COBRO → CxC.
  for (const r of regRes.data ?? []) {
    const saldo = Number(r.monto) - (liquidado.get(r.registro_id as string) ?? 0)
    if (saldo <= EPS) continue

    const dias    = diasHasta(r.vencimiento as string, hoy)
    const esGasto = r.tipo === 'GASTO'
    const quien   = r.tercero_id
      ? nombreTercero.get(`${r.client_id}:${r.tercero_id}`) ?? null
      : null
    const ctx = ctxDe.get(r.client_id as string)

    if (esGasto) {
      const tipo: 'cxp_vencida' | 'cxp_por_vencer' = dias < 0 ? 'cxp_vencida' : 'cxp_por_vencer'
      const umbral: Umbral | null = dias < 0 ? 'vencido' : umbralParaFecha('cxp_por_vencer', dias)
      if (!umbral) continue
      vivasCxp.add(r.client_id as string, r.registro_id as string)
      const ok = await crearNotificacion({
        clientId:  r.client_id as string,
        empresaId: r.empresa_id as string | null,
        tipo,
        titulo:    dias < 0
          ? `Pago vencido${quien ? ` — ${quien}` : ''}`
          : `Pago por vencer${quien ? ` — ${quien}` : ''}`,
        cuerpo:    `${r.descripcion}: ${dinero(saldo, r.moneda as string)} con vencimiento el ${fmtFechaEs(r.vencimiento as string)}.`,
        enlace:      '/portal/cxp',
        entidadTipo: 'documento',
        entidadId:   r.registro_id as string,
        umbral,
        sustituyeA:  ['cxp_por_vencer', 'cxp_vencida'],
      }, ctx)
      if (ok) creadas++
    } else if (dias < 0) {
      vivasCxc.add(r.client_id as string, r.registro_id as string)
      const ok = await crearNotificacion({
        clientId:  r.client_id as string,
        empresaId: r.empresa_id as string | null,
        tipo:      'cxc_vencida',
        titulo:    `Cobro vencido${quien ? ` — ${quien}` : ''}`,
        cuerpo:    `${r.descripcion}: quedan ${dinero(saldo, r.moneda as string)} por cobrar desde el ${fmtFechaEs(r.vencimiento as string)}.`,
        enlace:      '/portal/cxc',
        entidadTipo: 'documento',
        entidadId:   r.registro_id as string,
        umbral:      'vencido',
      }, ctx)
      if (ok) creadas++
    }
  }

  // Cobrado/pagado (o borrado) ⇒ la notificación deja de aplicar.
  for (const t of tenants) {
    await resolverNotificaciones(db, t.clientId, ['cxc_vencida'], 'documento', vivasCxc.de(t.clientId))
    await resolverNotificaciones(db, t.clientId, ['cxp_por_vencer', 'cxp_vencida'], 'documento', vivasCxp.de(t.clientId))
  }
  return creadas
}

// ── Finanzas: ofertas por caducar ─────────────────────────────────────────────
export async function escanearOfertas(
  db: Db, tenants: ContextoTenant[], hoy: string,
): Promise<number> {
  const ids = tenants.map(t => t.clientId)
  if (ids.length === 0) return 0

  // Solo las que siguen vivas comercialmente: una APROBADA ya no caduca y una
  // RECHAZADA/CADUCADA no hay por qué recordarla.
  const { data } = await db.from('ofertas')
    .select('oferta_id, client_id, empresa_id, numero, fecha_validez, moneda, total')
    .in('client_id', ids).eq('estado', 'ENVIADA').eq('archivado', false)
    .not('fecha_validez', 'is', null)

  const ctxDe = new Map(tenants.map(t => [t.clientId, t]))
  const vivas = new Vivas()
  let creadas = 0

  for (const o of data ?? []) {
    const dias   = diasHasta(o.fecha_validez as string, hoy)
    const umbral = dias < 0 ? null : umbralParaFecha('oferta_por_caducar', dias)
    if (!umbral) continue
    vivas.add(o.client_id as string, o.oferta_id as string)
    const ok = await crearNotificacion({
      clientId:    o.client_id as string,
      empresaId:   o.empresa_id as string | null,
      tipo:        'oferta_por_caducar',
      titulo:      `Oferta por caducar — ${o.numero}`,
      cuerpo:      `${dinero(Number(o.total), o.moneda as string)}. Válida hasta el ${fmtFechaEs(o.fecha_validez as string)}.`,
      enlace:      `/portal/ventas/ofertas/${o.oferta_id}`,
      entidadTipo: 'oferta',
      entidadId:   o.oferta_id as string,
      umbral,
      sustituyeA:  ['oferta_por_caducar'],
    }, ctxDe.get(o.client_id as string))
    if (ok) creadas++
  }

  for (const t of tenants) {
    await resolverNotificaciones(db, t.clientId, ['oferta_por_caducar'], 'oferta', vivas.de(t.clientId))
  }
  return creadas
}

// ── Caja: sesiones abiertas demasiado tiempo ──────────────────────────────────
export async function escanearCaja(db: Db, tenants: ContextoTenant[]): Promise<number> {
  const ids = tenants.map(t => t.clientId)
  if (ids.length === 0) return 0

  const { data } = await db.from('caja_sesiones')
    .select('sesion_uuid, client_id, empresa_id, caja_id, abierta_at')
    .in('client_id', ids).eq('estado', 'ABIERTA')

  const ctxDe = new Map(tenants.map(t => [t.clientId, t]))
  const vivas = new Vivas()
  let creadas = 0

  for (const s of data ?? []) {
    const horas = horasDesde(s.abierta_at as string)
    if (horas < HORAS_CAJA_ABIERTA) continue
    vivas.add(s.client_id as string, s.sesion_uuid as string)
    const ok = await crearNotificacion({
      clientId:    s.client_id as string,
      empresaId:   s.empresa_id as string | null,
      tipo:        'caja_abierta_sin_cerrar',
      titulo:      'Tienes una caja sin cerrar',
      cuerpo:      `La caja lleva ${Math.round(horas)} horas abierta. Ciérrala para que la venta llegue a Tesorería.`,
      enlace:      '/portal/caja',
      entidadTipo: 'caja_sesion',
      entidadId:   s.sesion_uuid as string,
    }, ctxDe.get(s.client_id as string))
    if (ok) creadas++
  }

  for (const t of tenants) {
    await resolverNotificaciones(db, t.clientId, ['caja_abierta_sin_cerrar'], 'caja_sesion', vivas.de(t.clientId))
  }
  return creadas
}

// ── Inventario: stock bajo y agotado ──────────────────────────────────────────
export async function escanearStock(db: Db, tenants: ContextoTenant[]): Promise<number> {
  const ids = tenants.map(t => t.clientId)
  if (ids.length === 0) return 0

  // Solo PRODUCTO: un SERVICIO no tiene existencias que reponer.
  const { data } = await db.from('products')
    .select('producto_id, client_id, nombre, unidad, stock_actual, stock_minimo')
    .in('client_id', ids).eq('tipo', 'PRODUCTO').eq('estado', 'ACTIVO')

  const ctxDe = new Map(tenants.map(t => [t.clientId, t]))
  const vivas = new Vivas()
  let creadas = 0

  for (const p of data ?? []) {
    const actual = Number(p.stock_actual ?? 0)
    const minimo = Number(p.stock_minimo ?? 0)
    // Sin mínimo definido no hay umbral que cruzar: solo avisa si se agota.
    const agotado = actual <= 0
    const bajo    = !agotado && minimo > 0 && actual <= minimo
    if (!agotado && !bajo) continue

    vivas.add(p.client_id as string, p.producto_id as string)
    const unidad = p.unidad ? ` ${p.unidad}` : ''
    const ok = await crearNotificacion({
      clientId: p.client_id as string,
      tipo:     agotado ? 'stock_agotado' : 'stock_bajo',
      titulo:   agotado ? `Sin existencias — ${p.nombre}` : `Stock bajo — ${p.nombre}`,
      cuerpo:   agotado
        ? 'Se agotó. Repón para poder seguir vendiéndolo.'
        : `Quedan ${actual}${unidad} y el mínimo es ${minimo}${unidad}.`,
      enlace:      `/portal/productos/${p.producto_id}`,
      entidadTipo: 'producto',
      entidadId:   p.producto_id as string,
      sustituyeA:  ['stock_bajo', 'stock_agotado'],
    }, ctxDe.get(p.client_id as string))
    if (ok) creadas++
  }

  for (const t of tenants) {
    await resolverNotificaciones(db, t.clientId, ['stock_bajo', 'stock_agotado'], 'producto', vivas.de(t.clientId))
  }
  return creadas
}

// ── RRHH: contratos temporales y nómina del mes ───────────────────────────────
export async function escanearRrhh(
  db: Db, tenants: ContextoTenant[], hoy: string,
): Promise<number> {
  const ids = tenants.map(t => t.clientId)
  if (ids.length === 0) return 0

  const [conRes, empRes, nomRes] = await Promise.all([
    db.from('contratos').select('contrato_id, client_id, empleado_id, fecha_fin')
      .in('client_id', ids).not('fecha_fin', 'is', null),
    db.from('empleados').select('empleado_id, client_id, nombre, apellidos, fecha_baja, fecha_nacimiento, documento_vencimiento')
      .in('client_id', ids),
    db.from('nominas').select('client_id, periodo').in('client_id', ids),
  ])

  const empleado = new Map(
    (empRes.data ?? []).map(e => [`${e.client_id}:${e.empleado_id}`, e]),
  )
  const ctxDe = new Map(tenants.map(t => [t.clientId, t]))
  const vivas = new Vivas()
  let creadas = 0

  for (const c of conRes.data ?? []) {
    const emp = empleado.get(`${c.client_id}:${c.empleado_id}`)
    // Un contrato de alguien que ya no trabaja aquí no hay que renovarlo.
    if (!emp || emp.fecha_baja) continue

    const dias    = diasHasta(c.fecha_fin as string, hoy)
    const vencido = dias < 0
    const tipo: 'contrato_empleado_vencido' | 'contrato_empleado_vence' =
      vencido ? 'contrato_empleado_vencido' : 'contrato_empleado_vence'
    const umbral: Umbral | null = vencido ? 'vencido' : umbralParaFecha(tipo, dias)
    if (!umbral) continue

    const nombre = `${emp.nombre}${emp.apellidos ? ` ${emp.apellidos}` : ''}`
    vivas.add(c.client_id as string, c.contrato_id as string)
    const ok = await crearNotificacion({
      clientId: c.client_id as string,
      tipo,
      titulo:   vencido
        ? `Contrato vencido — ${nombre}`
        : `Contrato por vencer — ${nombre}`,
      cuerpo:   vencido
        ? `Su contrato terminó el ${fmtFechaEs(c.fecha_fin as string)}.`
        : `Su contrato termina el ${fmtFechaEs(c.fecha_fin as string)}${dias === 0 ? ' (hoy)' : ` (faltan ${dias} día${dias === 1 ? '' : 's'})`}.`,
      enlace:      '/portal/contratos',
      entidadTipo: 'contrato',
      entidadId:   c.contrato_id as string,
      umbral,
      sustituyeA:  ['contrato_empleado_vence', 'contrato_empleado_vencido'],
    }, ctxDe.get(c.client_id as string))
    if (ok) creadas++
  }

  for (const t of tenants) {
    await resolverNotificaciones(
      db, t.clientId,
      ['contrato_empleado_vence', 'contrato_empleado_vencido'],
      'contrato', vivas.de(t.clientId),
    )
  }

  // Cumpleaños y caducidad de documentos (migración 111). Solo de quien sigue
  // de alta y solo si la fecha está puesta: son campos opcionales.
  const vivasDoc = new Vivas()
  for (const e of empRes.data ?? []) {
    if (e.fecha_baja) continue
    const nombre = `${e.nombre}${e.apellidos ? ` ${e.apellidos}` : ''}`

    // Cumpleaños: se compara mes y día, no la fecha entera. La entidad lleva el
    // año para que vuelva a felicitarse el que viene y no se repita este.
    if (e.fecha_nacimiento && (e.fecha_nacimiento as string).slice(5) === hoy.slice(5)) {
      const ok = await crearNotificacion({
        clientId:    e.client_id as string,
        tipo:        'cumpleanos_empleado',
        titulo:      `Hoy cumple años ${nombre}`,
        cuerpo:      'Un detalle hoy vale más que un aumento en diciembre.',
        enlace:      `/portal/rrhh/${e.empleado_id}`,
        entidadTipo: 'cumpleanos',
        entidadId:   `${e.empleado_id}:${hoy.slice(0, 4)}`,
      }, ctxDe.get(e.client_id as string))
      if (ok) creadas++
    }

    if (e.documento_vencimiento) {
      const dias    = diasHasta(e.documento_vencimiento as string, hoy)
      const vencido = dias < 0
      const tipo: 'documento_empleado_vencido' | 'documento_empleado_vence' =
        vencido ? 'documento_empleado_vencido' : 'documento_empleado_vence'
      const umbral: Umbral | null = vencido ? 'vencido' : umbralParaFecha(tipo, dias)
      if (umbral) {
        vivasDoc.add(e.client_id as string, e.empleado_id as string)
        const ok = await crearNotificacion({
          clientId: e.client_id as string,
          tipo,
          titulo:   vencido
            ? `Documento caducado — ${nombre}`
            : `Documento por caducar — ${nombre}`,
          cuerpo:   vencido
            ? `Su documento caducó el ${fmtFechaEs(e.documento_vencimiento as string)}.`
            : `Su documento caduca el ${fmtFechaEs(e.documento_vencimiento as string)}${dias === 0 ? ' (hoy)' : ` (faltan ${dias} día${dias === 1 ? '' : 's'})`}.`,
          enlace:      `/portal/rrhh/${e.empleado_id}`,
          entidadTipo: 'documento_empleado',
          entidadId:   e.empleado_id as string,
          umbral,
          sustituyeA:  ['documento_empleado_vence', 'documento_empleado_vencido'],
        }, ctxDe.get(e.client_id as string))
        if (ok) creadas++
      }
    }
  }
  for (const t of tenants) {
    await resolverNotificaciones(
      db, t.clientId,
      ['documento_empleado_vence', 'documento_empleado_vencido'],
      'documento_empleado', vivasDoc.de(t.clientId),
    )
  }

  // Nómina del mes: solo a partir del día 25, y solo si el tenant tiene personal
  // de alta (sin empleados no hay nómina que echar en falta).
  const diaDelMes = Number(hoy.slice(8, 10))
  const periodo   = hoy.slice(0, 7)
  const conNomina = new Set((nomRes.data ?? [])
    .filter(n => n.periodo === periodo).map(n => n.client_id as string))
  const conPersonal = new Set((empRes.data ?? [])
    .filter(e => !e.fecha_baja).map(e => e.client_id as string))
  const pendientes = new Vivas()

  if (diaDelMes >= DIA_AVISO_NOMINA) {
    for (const t of tenants) {
      if (conNomina.has(t.clientId) || !conPersonal.has(t.clientId)) continue
      pendientes.add(t.clientId, periodo)
      const ok = await crearNotificacion({
        clientId:    t.clientId,
        tipo:        'nomina_pendiente',
        titulo:      'Nómina del mes pendiente',
        cuerpo:      'Se acaba el mes y aún no has generado la nómina.',
        enlace:      '/portal/nomina',
        entidadTipo: 'nomina',
        entidadId:   periodo,   // una sola vez por mes
      }, t)
      if (ok) creadas++
    }
  }
  // Hecha la nómina (o entrado el mes siguiente), el aviso se archiva solo.
  for (const t of tenants) {
    await resolverNotificaciones(db, t.clientId, ['nomina_pendiente'], 'nomina', pendientes.de(t.clientId))
  }
  return creadas
}

// ── Terceros: crédito al límite ───────────────────────────────────────────────
// Suma lo que un cliente debe (facturas emitidas + cobros pendientes) y lo
// compara con el crédito que se le concedió.
export async function escanearCredito(db: Db, tenants: ContextoTenant[]): Promise<number> {
  const ids = tenants.map(t => t.clientId)
  if (ids.length === 0) return 0

  const { data: terceros } = await db.from('third_parties')
    .select('tercero_id, client_id, nombre, limite_credito')
    .in('client_id', ids).eq('activo', true).gt('limite_credito', 0)
  if (!terceros || terceros.length === 0) return 0

  const [movRes, facRes, regRes] = await Promise.all([
    db.from('movimientos_tesoreria').select('client_id, monto, monto_ref, referencia_id')
      .in('client_id', ids).in('origen', ['PAGO', 'COBRO']).not('referencia_id', 'is', null),
    db.from('facturas').select('factura_id, client_id, cliente_id, total')
      .in('client_id', ids).eq('estado', 'EMITIDA'),
    db.from('gastos_cobros').select('registro_id, client_id, tercero_id, monto')
      .in('client_id', ids).eq('tipo', 'COBRO'),
  ])

  const liquidado = new Map<string, number>()
  for (const m of movRes.data ?? []) {
    const id = m.referencia_id as string
    liquidado.set(id, (liquidado.get(id) ?? 0) + Number(m.monto_ref ?? m.monto))
  }

  // Deuda viva por (tenant, tercero). Mezcla monedas a propósito: es un semáforo,
  // no un saldo contable — el importe exacto por moneda está en CxC.
  const deuda = new Map<string, number>()
  const sumar = (clientId: unknown, terceroId: unknown, bruto: number, docId: string) => {
    if (!terceroId) return
    const saldo = bruto - (liquidado.get(docId) ?? 0)
    if (saldo <= 0.005) return
    const k = `${clientId}:${terceroId}`
    deuda.set(k, (deuda.get(k) ?? 0) + saldo)
  }
  for (const f of facRes.data ?? []) sumar(f.client_id, f.cliente_id, Number(f.total), f.factura_id as string)
  for (const r of regRes.data ?? []) sumar(r.client_id, r.tercero_id, Number(r.monto), r.registro_id as string)

  const ctxDe = new Map(tenants.map(t => [t.clientId, t]))
  const vivas = new Vivas()
  let creadas = 0

  for (const t of terceros) {
    const limite = Number(t.limite_credito)
    const debe   = deuda.get(`${t.client_id}:${t.tercero_id}`) ?? 0
    if (debe < limite * 0.9) continue

    const superado = debe >= limite
    vivas.add(t.client_id as string, t.tercero_id as string)
    const ok = await crearNotificacion({
      clientId: t.client_id as string,
      tipo:     'limite_credito_cerca',
      titulo:   superado
        ? `Crédito superado — ${t.nombre}`
        : `Crédito casi al tope — ${t.nombre}`,
      cuerpo:   `Debe ${debe.toLocaleString('es-ES', { maximumFractionDigits: 2 })} de un límite de ${limite.toLocaleString('es-ES', { maximumFractionDigits: 2 })}.`,
      enlace:      `/portal/terceros/${t.tercero_id}`,
      entidadTipo: 'credito',
      entidadId:   t.tercero_id as string,
    }, ctxDe.get(t.client_id as string))
    if (ok) creadas++
  }

  for (const t of tenants) {
    await resolverNotificaciones(db, t.clientId, ['limite_credito_cerca'], 'credito', vivas.de(t.clientId))
  }
  return creadas
}

// ── Reservas y Citas: resumen del día y pendientes de confirmar ───────────────
export async function escanearReservas(
  db: Db, tenants: ContextoTenant[], hoy: string,
): Promise<number> {
  const ids = tenants.map(t => t.clientId)
  if (ids.length === 0) return 0

  const [hoyRes, pendRes] = await Promise.all([
    db.from('reservas').select('client_id, recurso_id')
      .in('client_id', ids).eq('fecha', hoy).in('estado', ['PENDIENTE', 'CONFIRMADA']),
    db.from('reservas').select('reserva_id, client_id, created_at')
      .in('client_id', ids).eq('estado', 'PENDIENTE').gte('fecha', hoy),
  ])

  const ctxDe = new Map(tenants.map(t => [t.clientId, t]))
  let creadas = 0

  // 1. Resumen del día. Una sola notificación por tenant y fecha.
  const porTenant = new Map<string, { reservas: number; citas: number }>()
  for (const r of hoyRes.data ?? []) {
    const k = r.client_id as string
    const acc = porTenant.get(k) ?? { reservas: 0, citas: 0 }
    if (r.recurso_id) acc.citas++; else acc.reservas++
    porTenant.set(k, acc)
  }
  for (const [clientId, n] of porTenant) {
    const partes = [
      n.reservas > 0 ? `${n.reservas} reserva${n.reservas === 1 ? '' : 's'}` : null,
      n.citas    > 0 ? `${n.citas} cita${n.citas === 1 ? '' : 's'}` : null,
    ].filter(Boolean)
    const ok = await crearNotificacion({
      clientId,
      tipo:        'reservas_hoy',
      titulo:      `Hoy tienes ${partes.join(' y ')}`,
      cuerpo:      'Repasa la agenda del día antes de abrir.',
      enlace:      n.citas > 0 && n.reservas === 0 ? '/portal/citas' : '/portal/reservas',
      entidadTipo: 'agenda_dia',
      entidadId:   hoy,
    }, ctxDe.get(clientId))
    if (ok) creadas++
  }
  // El resumen de ayer ya no sirve para nada: se archiva al llegar el de hoy.
  for (const t of tenants) {
    await resolverNotificaciones(
      db, t.clientId, ['reservas_hoy'], 'agenda_dia',
      porTenant.has(t.clientId) ? [hoy] : [],
    )
  }

  // 2. Pendientes de confirmar desde hace horas: el cliente sigue esperando.
  const vivas = new Vivas()
  for (const r of pendRes.data ?? []) {
    if (horasDesde(r.created_at as string) < HORAS_SIN_CONFIRMAR) continue
    vivas.add(r.client_id as string, r.reserva_id as string)
  }
  for (const t of tenants) {
    const pendientes = vivas.de(t.clientId)
    if (pendientes.length > 0) {
      const ok = await crearNotificacion({
        clientId:    t.clientId,
        tipo:        'reserva_pendiente_confirmar',
        titulo:      `${pendientes.length} reserva${pendientes.length === 1 ? '' : 's'} sin confirmar`,
        cuerpo:      'Llevan horas esperando respuesta. Confírmalas o recházalas.',
        enlace:      '/portal/reservas',
        entidadTipo: 'pendientes_dia',
        entidadId:   hoy,
      }, t)
      if (ok) creadas++
    }
    // El aviso de ayer se archiva: o ya se confirmaron, o hoy hay uno nuevo.
    await resolverNotificaciones(
      db, t.clientId, ['reserva_pendiente_confirmar'], 'pendientes_dia',
      pendientes.length > 0 ? [hoy] : [],
    )
  }
  return creadas
}

// ── IA: cupo mensual cerca del tope ───────────────────────────────────────────
export async function escanearIa(tenants: ContextoTenant[]): Promise<number> {
  let creadas = 0
  for (const t of tenants) {
    const uso = await obtenerUsoMes(t.clientId)
    if (!uso.cercaDelTope) continue
    const ok = await crearNotificacion({
      clientId:    t.clientId,
      tipo:        'ia_cupo_cerca',
      titulo:      'Tu asistente está cerca del cupo',
      cuerpo:      `Llevas ${uso.conversaciones} de ${uso.cupo} conversaciones este mes. No se corta nada: el cupo se renueva al empezar el mes.`,
      enlace:      '/portal/ia',
      entidadTipo: 'ia_cupo',
      entidadId:   uso.periodo,   // una vez por mes
    }, t)
    if (ok) creadas++
  }
  return creadas
}

// ── Dossier: snapshot rancio ──────────────────────────────────────────────────
// Solo molesta si está PUBLICADO: un borrador con números viejos no lo ve nadie.
export async function escanearDossier(db: Db, tenants: ContextoTenant[]): Promise<number> {
  const ids = tenants.map(t => t.clientId)
  if (ids.length === 0) return 0

  const { data } = await db.from('dossiers')
    .select('dossier_id, client_id, empresa_id, titulo, snapshot_at, snapshot_stale')
    .in('client_id', ids).eq('estado', 'PUBLICADO')

  const ctxDe = new Map(tenants.map(t => [t.clientId, t]))
  const vivas = new Vivas()
  let creadas = 0

  for (const d of data ?? []) {
    const dias = d.snapshot_at
      ? Math.round((Date.now() - new Date(d.snapshot_at as string).getTime()) / MS_DIA)
      : null
    // `snapshot_stale` lo marca el propio dossier cuando cambian los datos base;
    // la antigüedad cubre el caso de un negocio que sigue operando sin tocarlo.
    const rancio = d.snapshot_stale === true || (dias !== null && dias > DIAS_DOSSIER_RANCIO)
    if (!rancio) continue

    vivas.add(d.client_id as string, d.dossier_id as string)
    const ok = await crearNotificacion({
      clientId:    d.client_id as string,
      empresaId:   d.empresa_id as string | null,
      tipo:        'dossier_snapshot_desactualizado',
      titulo:      `Tu dossier muestra números viejos${d.titulo ? ` — ${d.titulo}` : ''}`,
      cuerpo:      dias !== null
        ? `Los datos publicados son de hace ${dias} días. Actualízalos para que el enlace enseñe la foto de ahora.`
        : 'Han cambiado datos desde la última actualización del dossier.',
      enlace:      '/portal/dossier',
      entidadTipo: 'dossier',
      entidadId:   d.dossier_id as string,
    }, ctxDe.get(d.client_id as string))
    if (ok) creadas++
  }

  for (const t of tenants) {
    await resolverNotificaciones(db, t.clientId, ['dossier_snapshot_desactualizado'], 'dossier', vivas.de(t.clientId))
  }
  return creadas
}
