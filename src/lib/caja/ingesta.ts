// Núcleo server-only del módulo Caja. Construye la SEMILLA (productos/monedas/
// tasas/config) que baja al dispositivo, e INGESTA el lote de tickets+cierres de
// forma idempotente. Compartido por los endpoints públicos tokenizados
// (/caja/api/seed y /caja/api/sync) y por la subida de archivo del portal
// (ingestarLoteArchivo en actions/portal/caja.ts).
//
// Regla de independencia (CONTEXTO §2): la caja guarda SIEMPRE su propio detalle
// (caja_tickets/caja_ticket_lineas). Los efectos en módulos compartidos son
// RESÚMENES POR CIERRE, y solo si el cliente tiene el módulo:
//   · base       → un INGRESO de Tesorería por moneda (origen='CAJA').
//   · inventario → un SALIDA de Inventario por producto (origen='VENTA', permitir_negativo).
// Idempotencia: ticket_uuid (detalle) y los flags tesoreria_movs/stock_movs del
// cierre (resúmenes). Re-sincronizar o re-subir un archivo no duplica.

import { tieneModulo } from '@/lib/modulos'
import { aplicarMovimiento } from '@/app/actions/portal/_inventario-helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface CajaRow {
  caja_id:           string
  client_id:         string
  empresa_id:        string
  almacen_id:        string | null
  cuentas_moneda:    Record<string, string>
  monedas_aceptadas: string[]
  activa?:           boolean
}

export interface LineaIn {
  producto_id?:    string | null
  descripcion:     string
  cantidad:        number
  precio_unitario: number
  subtotal:        number
}
export interface TicketIn {
  ticket_uuid:  string
  sesion_uuid?: string | null
  fecha:        string
  moneda:       string
  total:        number
  medio_pago?:  string | null
  estado?:      'VIGENTE' | 'ANULADO' | 'RECTIFICACION'
  rectifica_a?: string | null   // ticket_uuid del original (solo en RECTIFICACION)
  lineas:       LineaIn[]
}
export interface CierreIn {
  sesion_uuid:       string
  abierta_at:        string
  cerrada_at?:       string | null
  estado?:           string
  fondo_inicial?:    Record<string, number>
  efectivo_contado?: Record<string, number>
}
export interface LotePayload { tickets?: TicketIn[]; cierres?: CierreIn[] }

export interface IngestaResultado {
  tickets_nuevos:    number
  cierres_posteados: number
  duplicados:        number
  errores:           string[]
}

function generarMovId(): string {
  return `MOV-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

/** Token de la caja: cabecera x-caja-token o query ?t= (el fragmento no viaja al servidor). */
export function getCajaToken(req: Request): string | null {
  const h = req.headers.get('x-caja-token')
  if (h) return h.trim()
  const q = new URL(req.url).searchParams.get('t')
  return q ? q.trim() : null
}

// ── SEMILLA (Claux → dispositivo) ─────────────────────────────────────────────

export async function construirSeed(db: Db, caja: CajaRow) {
  const { data: cli } = await db.from('clients').select('modulos_activos').eq('client_id', caja.client_id).maybeSingle()
  const tieneInv = tieneModulo(cli?.modulos_activos, 'inventario')

  const [prodRes, monRes, tasaRes] = await Promise.all([
    tieneInv
      ? db.from('products')
          .select('producto_id, codigo, nombre, precios, unidad')
          .eq('client_id', caja.client_id).eq('estado', 'ACTIVO').order('nombre')
      : Promise.resolve({ data: [] }),
    db.from('monedas').select('codigo, simbolo').eq('client_id', caja.client_id).eq('activa', true).order('codigo'),
    db.from('tasas_cambio')
      .select('moneda_origen, moneda_destino, tasa, fecha')
      .eq('client_id', caja.client_id).order('fecha', { ascending: false }),
  ])

  // Tasa más reciente por par (primera al venir ordenado por fecha desc).
  const seen = new Set<string>()
  const tasas: { origen: string; destino: string; tasa: number }[] = []
  for (const t of (tasaRes.data ?? [])) {
    const k = `${t.moneda_origen}__${t.moneda_destino}`
    if (seen.has(k)) continue
    seen.add(k)
    tasas.push({ origen: t.moneda_origen, destino: t.moneda_destino, tasa: Number(t.tasa) })
  }

  return {
    caja: {
      caja_id:           caja.caja_id,
      empresa_id:        caja.empresa_id,
      almacen_id:        caja.almacen_id,
      monedas_aceptadas: caja.monedas_aceptadas ?? [],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productos: (prodRes.data ?? []).map((p: any) => ({
      producto_id: p.producto_id, codigo: p.codigo, nombre: p.nombre,
      precios: p.precios ?? {}, unidad: p.unidad,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monedas: (monRes.data ?? []).map((m: any) => ({ codigo: m.codigo, simbolo: m.simbolo || m.codigo })),
    tasas,
  }
}

// ── INGESTA (dispositivo → Claux) ─────────────────────────────────────────────

export async function ingestarLote(
  db: Db, caja: CajaRow, payload: LotePayload, origenSync: 'ONLINE' | 'ARCHIVO',
): Promise<IngestaResultado> {
  const res: IngestaResultado = { tickets_nuevos: 0, cierres_posteados: 0, duplicados: 0, errores: [] }

  const { data: cli } = await db.from('clients').select('modulos_activos').eq('client_id', caja.client_id).maybeSingle()
  const tieneBase = tieneModulo(cli?.modulos_activos, 'base')
  const tieneInv  = tieneModulo(cli?.modulos_activos, 'inventario')

  const tickets = Array.isArray(payload.tickets) ? payload.tickets : []
  const cierres = Array.isArray(payload.cierres) ? payload.cierres : []

  // ── A. Detalle: tickets (idempotente por ticket_uuid) ──
  for (const t of tickets) {
    if (!t?.ticket_uuid || !t.fecha || !t.moneda) { res.errores.push('ticket inválido (faltan campos)'); continue }
    const { data: nuevo, error } = await db.from('caja_tickets').upsert({
      ticket_uuid: t.ticket_uuid,
      caja_id:     caja.caja_id,
      client_id:   caja.client_id,
      empresa_id:  caja.empresa_id,
      sesion_uuid: t.sesion_uuid ?? null,
      fecha:       t.fecha,
      moneda:      t.moneda,
      total:       Number(t.total) || 0,
      medio_pago:  t.medio_pago ?? null,
      estado:      t.estado ?? 'VIGENTE',
      rectifica_a: t.rectifica_a ?? null,
      origen_sync: origenSync,
    }, { onConflict: 'ticket_uuid', ignoreDuplicates: true }).select('ticket_uuid')

    if (error)                      { res.errores.push(`ticket ${t.ticket_uuid}: ${error.message}`); continue }
    if (!nuevo || nuevo.length === 0) {
      // Ya existía. Si vuelve como ANULADO (se rectificó un ticket ya sincronizado),
      // propagamos solo el cambio de estado; las líneas no se re-insertan.
      res.duplicados++
      if ((t.estado ?? 'VIGENTE') === 'ANULADO') {
        await db.from('caja_tickets')
          .update({ estado: 'ANULADO', rectifica_a: t.rectifica_a ?? null })
          .eq('ticket_uuid', t.ticket_uuid).eq('client_id', caja.client_id)
      }
      continue
    }
    res.tickets_nuevos++

    const lineas = Array.isArray(t.lineas) ? t.lineas : []
    if (lineas.length) {
      const { error: lErr } = await db.from('caja_ticket_lineas').insert(lineas.map(l => ({
        ticket_uuid:     t.ticket_uuid,
        client_id:       caja.client_id,
        producto_id:     l.producto_id ?? null,
        descripcion:     l.descripcion ?? '',
        cantidad:        Number(l.cantidad) || 0,
        precio_unitario: Number(l.precio_unitario) || 0,
        subtotal:        Number(l.subtotal) || 0,
      })))
      if (lErr) res.errores.push(`líneas ${t.ticket_uuid}: ${lErr.message}`)
    }
  }

  // ── B. Resúmenes por cierre (solo CERRADA; idempotente por flags) ──
  for (const c of cierres) {
    if (!c?.sesion_uuid) continue
    try {
      await ensureCierre(db, caja, c)
      if ((c.estado ?? 'CERRADA') !== 'CERRADA') continue
      const posted = await postearResumenCierre(db, caja, c.sesion_uuid, tieneBase, tieneInv)
      if (posted) res.cierres_posteados++
    } catch (e) {
      res.errores.push(`cierre ${c.sesion_uuid}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  await db.from('cajas').update({ last_sync_at: new Date().toISOString() }).eq('caja_id', caja.caja_id)
  return res
}

// Crea/actualiza la fila del cierre (detalle). NO toca los flags de posteo
// (tesoreria_movs/stock_movs/posted_at): se preservan al no incluirlos.
async function ensureCierre(db: Db, caja: CajaRow, c: CierreIn) {
  await db.from('caja_sesiones').upsert({
    sesion_uuid:      c.sesion_uuid,
    caja_id:          caja.caja_id,
    client_id:        caja.client_id,
    empresa_id:       caja.empresa_id,
    abierta_at:       c.abierta_at,
    cerrada_at:       c.cerrada_at ?? null,
    estado:           c.estado ?? 'CERRADA',
    fondo_inicial:    c.fondo_inicial ?? {},
    efectivo_contado: c.efectivo_contado ?? {},
    sincronizado_at:  new Date().toISOString(),
  }, { onConflict: 'sesion_uuid' })
}

// Postea los resúmenes de un cierre a Tesorería/Inventario. Idempotente: solo
// postea cada efecto si su flag está null (no se re-postea al re-sincronizar).
// Devuelve true si aplicó algún resumen.
async function postearResumenCierre(
  db: Db, caja: CajaRow, sesionUuid: string, tieneBase: boolean, tieneInv: boolean,
): Promise<boolean> {
  const { data: ses } = await db.from('caja_sesiones')
    .select('tesoreria_movs, stock_movs, cerrada_at').eq('sesion_uuid', sesionUuid).maybeSingle()
  if (!ses) return false

  const fecha = (ses.cerrada_at ?? new Date().toISOString()).split('T')[0]
  let did = false

  // Totales por moneda desde los tickets sincronizados de este cierre. Los ANULADO
  // (rectificados) se excluyen → Tesorería e Inventario reciben el NETO corregido.
  const { data: tks } = await db.from('caja_tickets')
    .select('ticket_uuid, moneda, total, estado').eq('sesion_uuid', sesionUuid)
  const vigentes = (tks ?? []).filter((t: { estado?: string }) => (t.estado ?? 'VIGENTE') !== 'ANULADO')
  const ticketUuids = vigentes.map((t: { ticket_uuid: string }) => t.ticket_uuid)
  const porMoneda = new Map<string, number>()
  for (const t of vigentes) porMoneda.set(t.moneda, (porMoneda.get(t.moneda) ?? 0) + Number(t.total))

  // ── Tesorería: un INGRESO resumen por moneda ──
  if (tieneBase && ses.tesoreria_movs == null && porMoneda.size > 0) {
    const movs: Record<string, string> = {}
    for (const [moneda, monto] of porMoneda) {
      const cuentaId = caja.cuentas_moneda?.[moneda]
      if (!cuentaId) continue // sin cuenta CAJA mapeada para esta moneda → config pendiente
      const movId = generarMovId()
      const { error } = await db.from('movimientos_tesoreria').insert({
        movimiento_id: movId,
        client_id:     caja.client_id,
        empresa_id:    caja.empresa_id,
        cuenta_id:     cuentaId,
        fecha,
        tipo:          'INGRESO',
        monto,
        moneda,
        monto_ref:     monto,
        concepto:      `Ventas de caja — cierre ${sesionUuid.substring(0, 8)}`,
        origen:        'CAJA',
        referencia_id: sesionUuid,
      })
      if (error) throw new Error(`tesorería ${moneda}: ${error.message}`)
      movs[moneda] = movId
    }
    await db.from('caja_sesiones').update({ tesoreria_movs: movs }).eq('sesion_uuid', sesionUuid).is('tesoreria_movs', null)
    did = true
  }

  // ── Inventario: un SALIDA resumen por producto ──
  if (tieneInv && caja.almacen_id && ses.stock_movs == null && ticketUuids.length > 0) {
    const { data: lineas } = await db.from('caja_ticket_lineas')
      .select('producto_id, cantidad').in('ticket_uuid', ticketUuids).not('producto_id', 'is', null)
    const porProd = new Map<string, number>()
    for (const l of (lineas ?? [])) porProd.set(l.producto_id, (porProd.get(l.producto_id) ?? 0) + Number(l.cantidad))

    const movs: Record<string, string> = {}
    for (const [producto_id, cantidad] of porProd) {
      if (cantidad <= 0) continue
      const r = await aplicarMovimiento(db, {
        client_id:  caja.client_id,
        empresa_id: caja.empresa_id,
        fecha,
        tipo:       'SALIDA',
        producto_id,
        almacen_id: caja.almacen_id,
        cantidad,
        motivo:     `Ventas de caja — cierre ${sesionUuid.substring(0, 8)}`,
        origen:     'VENTA',
        referencia_id: sesionUuid,
        permitir_negativo: true,
      })
      movs[producto_id] = r.movimiento_id
    }
    await db.from('caja_sesiones').update({ stock_movs: movs }).eq('sesion_uuid', sesionUuid).is('stock_movs', null)
    did = true
  }

  await db.from('caja_sesiones').update({
    total_por_moneda: Object.fromEntries(porMoneda),
    posted_at:        new Date().toISOString(),
  }).eq('sesion_uuid', sesionUuid)

  return did
}
