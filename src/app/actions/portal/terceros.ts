'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, accesoModulosSession, puedeEditarAlgunModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { obtenerMonedasActivas, type MonedaOpcion } from './monedas'
import { mapaTasas, monedaValida, construirConversor } from '@/lib/tasas'
import { ESTADOS_FACTURA_INGRESO, ESTADOS_COMPRA_GASTO } from '@/lib/contabilidad'
import { mesesEntre, hoyEnTz } from '@/lib/fecha-tz'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type TipoTercero   = 'CLIENTE' | 'PROVEEDOR' | 'AMBOS'
export type CondicionPago = 'CONTADO' | '15' | '30' | '60' | '90'

/**
 * Cómo se le paga a un tercero. Dato documental (se muestra en su ficha; no lo
 * consumen Tesorería ni las facturas). Se guarda como jsonb, así que los campos
 * son todos opcionales: cada `tipo` usa los suyos. El catálogo de tipos y qué
 * campos pide cada uno viven en `(app)/terceros/_vias-pago.ts`.
 */
export interface ViaPago {
  tipo:         string
  /** Moneda de la vía, de las que el cliente tiene configuradas. */
  moneda?:      string
  // Transferencia bancaria · Transfermóvil · EnZona · internacional
  titular?:     string
  cuenta?:      string        // cuenta o tarjeta
  banco?:       string
  telefono?:    string
  tipo_cuenta?: string        // Checking | Savings (solo internacional)
  // Transferencia internacional (extras)
  swift?:       string
  routing?:     string
  id_titular?:  string
  direccion?:   string
  // Zelle · TropiPay
  nombre?:      string
  contacto?:    string        // teléfono o email
  email_link?:  string
  // Efectivo
  referencia?:  string
}

export interface Tercero {
  tercero_id:             string
  client_id:              string
  empresa_id:             string
  tipo:                   TipoTercero
  nombre:                 string
  identificacion:         string | null
  representante:          string | null
  cargo:                  string | null
  telefono:               string | null
  email:                  string | null
  direccion:              string | null
  ciudad:                 string | null
  pais:                   string | null
  condicion_pago:         CondicionPago
  limite_credito:         number | null
  moneda_defecto:         string | null
  via_primaria:           ViaPago | null
  via_secundaria:         ViaPago | null
  contrato_url:           string | null
  num_contrato:           string | null
  fecha_inicio_contrato:  string | null
  fecha_fin_contrato:     string | null
  notas:                  string | null
  activo:                 boolean
  created_at:             string
  updated_at:             string
}

export interface TercerosPageData {
  terceros:        Tercero[]
  empresa_nombres: Record<string, string>
  empresas:        EmpresaDestino[]
  monedas:         MonedaOpcion[]
  /** Factores entre las monedas del cliente ("ORIGEN__DESTINO" → factor). */
  tasas:           Record<string, number>
}

/** Empresa como destino de copia: su moneda funcional es la que se propone. */
export interface EmpresaDestino {
  empresa_id:       string
  nombre:           string
  moneda_funcional: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generarTerceroId(): string {
  return `TER-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

function validarTipo(v: string): TipoTercero {
  return (['CLIENTE', 'PROVEEDOR', 'AMBOS'] as TipoTercero[]).includes(v as TipoTercero)
    ? (v as TipoTercero)
    : 'CLIENTE'
}

function validarCondicion(v: string): CondicionPago {
  return (['CONTADO', '15', '30', '60', '90'] as CondicionPago[]).includes(v as CondicionPago)
    ? (v as CondicionPago)
    : 'CONTADO'
}

function parseVia(str: string): ViaPago | null {
  if (!str) return null
  try { return JSON.parse(str) as ViaPago }
  catch { return null }
}

// Acepta un código de moneda de un formulario. Se exige que esté configurada y
// activa SALVO que sea la que la ficha ya tenía: una moneda vieja no debe
// impedir editar el teléfono de un tercero, pero tampoco se admiten códigos
// nuevos que no cotizan.
async function monedaAceptable(
  db:       ReturnType<typeof createAdminClient>,
  clientId: string,
  codigo:   string | null,
  actual:   string | null,
): Promise<boolean> {
  if (!codigo || codigo === actual) return true
  return monedaValida(db, clientId, codigo)
}

// ── Obtener terceros ──────────────────────────────────────────────────────────

export async function obtenerTerceros(): Promise<TercerosPageData> {
  const session = await getPortalSession()
  const vacio: TercerosPageData = { terceros: [], empresa_nombres: {}, empresas: [], monedas: [], tasas: {} }
  if (!session) return vacio

  const db = createAdminClient()
  const [empresas, monedas] = await Promise.all([obtenerEmpresas(), obtenerMonedasActivas()])
  const tasas = await mapaTasas(db, session.client_id, monedas.map(m => m.codigo))
  const empresa_ids = empresas.map(e => e.empresa_id)

  if (!empresa_ids.length) return { ...vacio, monedas, tasas }

  const { data } = await db
    .from('third_parties')
    .select('*')
    .eq('client_id', session.client_id)
    .in('empresa_id', empresa_ids)
    .order('nombre')

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  return {
    terceros:        (data ?? []) as Tercero[],
    empresa_nombres,
    empresas:        empresas.map(e => ({
      empresa_id: e.empresa_id, nombre: e.nombre, moneda_funcional: e.moneda_funcional,
    })),
    monedas,
    tasas,
  }
}

// ── Guardar (crear / actualizar) ──────────────────────────────────────────────

export async function guardarTercero(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; tercero_id?: string }> {
  const session = await getPortalSession()
  if (!session)          return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(['base', 'inventario']))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const nombre = ((formData.get('nombre') as string) ?? '').trim()
  if (!nombre) return { ok: false, error: 'El nombre del tercero es obligatorio.' }

  const empresa_id = ((formData.get('empresa_id') as string) ?? '').trim()
  if (!empresa_id) return { ok: false, error: 'Debes seleccionar una empresa.' }

  const empresas  = await obtenerEmpresas()
  const empresaOk = empresas.some(e => e.empresa_id === empresa_id)
  if (!empresaOk) return { ok: false, error: 'Empresa no válida.' }

  const db = createAdminClient()

  const limite_str    = ((formData.get('limite_credito') as string) ?? '').trim()
  const limite_credito = limite_str ? parseFloat(limite_str) : null

  // Vías de pago (JSON serializado por el cliente)
  const via_primaria  = parseVia((formData.get('via_primaria')  as string) ?? '')
  const via_secundaria = parseVia((formData.get('via_secundaria') as string) ?? '')

  // ID del tercero (nuevo o existente)
  const tercero_id_form = ((formData.get('tercero_id') as string) ?? '').trim()
  const tercero_id      = tercero_id_form || generarTerceroId()

  // Moneda: solo códigos que el cliente tiene configurados (o el que ya traía).
  const moneda_defecto = ((formData.get('moneda_defecto') as string) ?? '').trim() || null
  const { data: previo } = tercero_id_form
    ? await db.from('third_parties').select('moneda_defecto')
        .eq('tercero_id', tercero_id_form).eq('client_id', session.client_id).maybeSingle()
    : { data: null }
  if (!await monedaAceptable(db, session.client_id, moneda_defecto, previo?.moneda_defecto ?? null)) {
    return { ok: false, error: `La moneda "${moneda_defecto}" no está configurada en Monedas y Tasas.` }
  }

  // ── Subir contrato si se adjuntó ──────────────────────────────────────────
  const contratoFile = formData.get('contrato') as File | null
  const existingUrl  = ((formData.get('contrato_url') as string) ?? '').trim() || null
  let   contrato_url = existingUrl

  if (contratoFile && contratoFile.size > 0) {
    if (contratoFile.size > 10 * 1024 * 1024)
      return { ok: false, error: 'El contrato no puede superar 10 MB.' }

    const tiposOk = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
    if (!tiposOk.includes(contratoFile.type))
      return { ok: false, error: 'Formato no válido. Usa PDF, JPG o PNG.' }

    const ext    = contratoFile.name.split('.').pop()?.toLowerCase() || 'pdf'
    const path   = `${session.client_id}/${tercero_id}.${ext}`
    // Subir como Blob, no como Buffer: el Buffer se corrompe en el serverless de
    // Vercel (recodificado a UTF-8). Ver memoria storage-upload-blob-no-buffer.
    const buffer = Buffer.from(await contratoFile.arrayBuffer())
    const blob   = new Blob([new Uint8Array(buffer)], { type: contratoFile.type })

    const { error: upErr } = await db.storage
      .from('contratos')
      .upload(path, blob, { contentType: contratoFile.type, upsert: true })

    if (upErr) return { ok: false, error: 'Error al subir el contrato.' }

    const { data: { publicUrl } } = db.storage.from('contratos').getPublicUrl(path)
    contrato_url = publicUrl
  }

  // ── Campos comunes ────────────────────────────────────────────────────────
  const campos = {
    empresa_id,
    tipo:                   validarTipo((formData.get('tipo') as string) ?? ''),
    nombre,
    identificacion:         ((formData.get('identificacion')  as string) ?? '').trim() || null,
    representante:          ((formData.get('representante')   as string) ?? '').trim() || null,
    cargo:                  ((formData.get('cargo')           as string) ?? '').trim() || null,
    telefono:               ((formData.get('telefono')        as string) ?? '').trim() || null,
    email:                  ((formData.get('email')           as string) ?? '').trim() || null,
    direccion:              ((formData.get('direccion')       as string) ?? '').trim() || null,
    ciudad:                 ((formData.get('ciudad')          as string) ?? '').trim() || null,
    pais:                   ((formData.get('pais')            as string) ?? '').trim() || null,
    condicion_pago:         validarCondicion((formData.get('condicion_pago') as string) ?? ''),
    limite_credito:         (limite_credito !== null && !isNaN(limite_credito)) ? limite_credito : null,
    moneda_defecto,
    via_primaria:           via_primaria  as object | null,
    via_secundaria:         via_secundaria as object | null,
    contrato_url,
    num_contrato:           ((formData.get('num_contrato')           as string) ?? '').trim() || null,
    fecha_inicio_contrato:  ((formData.get('fecha_inicio_contrato')  as string) ?? '').trim() || null,
    fecha_fin_contrato:     ((formData.get('fecha_fin_contrato')     as string) ?? '').trim() || null,
    notas:                  ((formData.get('notas')           as string) ?? '').trim() || null,
    updated_at:             new Date().toISOString(),
  }

  if (!tercero_id_form) {
    const { error } = await db.from('third_parties').insert({
      tercero_id,
      client_id:  session.client_id,
      activo:     true,
      created_at: new Date().toISOString(),
      ...campos,
    })
    if (error) { console.error('[terceros] insert error:', error); return { ok: false, error: `DB: ${error.message} | code: ${error.code}` } }
    revalidatePath('/portal/terceros')
    return { ok: true, tercero_id }
  }

  const { error } = await db
    .from('third_parties')
    .update(campos)
    .eq('tercero_id', tercero_id_form)
    .eq('client_id', session.client_id)

  if (error) { console.error('[terceros] update error:', error); return { ok: false, error: 'Error al actualizar el tercero.' } }
  revalidatePath('/portal/terceros')
  return { ok: true, tercero_id: tercero_id_form }
}

// ── Archivar ──────────────────────────────────────────────────────────────────

// Copia un cliente/proveedor a otra empresa como ficha INDEPENDIENTE (mismos datos,
// nuevo id). Cada empresa mantiene su propia relación comercial (CxC/CxP, moneda),
// por eso es un registro separado a propósito, no una identidad compartida.
// `moneda` es la de la ficha nueva (el modal propone la funcional de la empresa
// destino): copiar a una empresa que opera en otra moneda y arrastrar la de
// origen es justo lo que dejaba fichas descuadradas. `limite` llega ya en esa
// moneda — el modal lo convierte con la tasa vigente y deja corregirlo.
export async function copiarTerceroAEmpresa(
  tercero_id: string,
  empresa_destino: string,
  moneda?: string | null,
  limite?: number | null,
): Promise<{ ok: boolean; error?: string; tercero_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(['base', 'inventario']))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_destino)) {
    return { ok: false, error: 'Empresa destino no válida.' }
  }

  const db = createAdminClient()
  const { data: src } = await db.from('third_parties').select('*')
    .eq('tercero_id', tercero_id).eq('client_id', session.client_id).maybeSingle()
  if (!src) return { ok: false, error: 'No se encontró el cliente o proveedor a copiar.' }
  if (!empresas.some(e => e.empresa_id === src.empresa_id)) {
    return { ok: false, error: 'Sin acceso al registro original.' }
  }
  if (src.empresa_id === empresa_destino) {
    return { ok: false, error: 'El cliente ya pertenece a esa empresa.' }
  }

  const monedaFinal = moneda?.trim() || null
  if (monedaFinal && !await monedaValida(db, session.client_id, monedaFinal)) {
    return { ok: false, error: `La moneda "${monedaFinal}" no está configurada.` }
  }

  // El límite de crédito solo significa algo en su moneda: 5.000 USD copiados
  // a CUP serían un límite absurdo.
  const limite_credito = (limite != null && !isNaN(limite) && limite >= 0)
    ? limite
    : (src.limite_credito as number | null)

  const nuevo_id = generarTerceroId()
  const ahora    = new Date().toISOString()

  // OJO: la PRIMARY KEY real de third_parties es `id` (uuid), NO `tercero_id`
  // — este último es solo el código legible TER-XXXXXXXX. La migración
  // 008_terceros.sql declaraba `tercero_id primary key`, pero la tabla ya existía
  // creada a mano y el `create table if not exists` nunca llegó a aplicarse.
  // Si `id` se cuela en el spread, el INSERT reusa la del original y choca
  // contra third_parties_pkey; hay que dejar que Postgres genere una nueva con
  // su default gen_random_uuid().
  const { id: _id, ...datosOrigen } = src as Record<string, unknown>
  void _id

  const { error } = await db.from('third_parties').insert({
    ...datosOrigen,
    tercero_id:     nuevo_id,
    empresa_id:     empresa_destino,
    moneda_defecto: monedaFinal,
    limite_credito,
    activo:         true,
    created_at:     ahora,
    updated_at:     ahora,
  })
  if (error) { console.error('[terceros] copiar error:', error); return { ok: false, error: `No se pudo copiar: ${error.message}` } }
  revalidatePath('/portal/terceros')
  return { ok: true, tercero_id: nuevo_id }
}

export async function archivarTercero(
  tercero_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(['base', 'inventario']))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db
    .from('third_parties')
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq('tercero_id', tercero_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al archivar el tercero.' }
  revalidatePath('/portal/terceros')
  return { ok: true }
}

// ── Restaurar ─────────────────────────────────────────────────────────────────

export async function restaurarTercero(
  tercero_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(['base', 'inventario']))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db
    .from('third_parties')
    .update({ activo: true, updated_at: new Date().toISOString() })
    .eq('tercero_id', tercero_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'Error al restaurar el tercero.' }
  revalidatePath('/portal/terceros')
  return { ok: true }
}

// ── Acciones en lote (Fase 1 — archivar/restaurar, soft y reversible) ───────────
//
// Recurso compartido → candado `puedeEditarAlgunModulo(['base','inventario'])`
// inline (audit-gating). Un solo UPDATE atómico scoped por client_id + tercero_id.
// No hay eliminar: los terceros se referencian en documentos; solo se archivan.

export interface ResultadoLoteTerceros { ok: boolean; hechas: number; error?: string }

export async function archivarTercerosEnLote(
  ids: string[], archivar: boolean,
): Promise<ResultadoLoteTerceros> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, hechas: 0, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(['base', 'inventario']))) return { ok: false, hechas: 0, error: 'No tienes permiso para editar en este módulo.' }
  if (!ids.length) return { ok: true, hechas: 0 }

  const db = createAdminClient()
  const { data, error } = await db.from('third_parties')
    .update({ activo: !archivar, updated_at: new Date().toISOString() })
    .eq('client_id', session.client_id).in('tercero_id', ids)
    .select('tercero_id')
  if (error) return { ok: false, hechas: 0, error: error.message }
  revalidatePath('/portal/terceros')
  return { ok: true, hechas: (data ?? []).length }
}

// ── Detalle de tercero ────────────────────────────────────────────────────────

// ── Historial de transacciones del tercero ────────────────────────────────────

/** Un documento del historial. `clase` distingue las dos naturalezas: a un
 *  tercero AMBOS le vendemos (facturas) y le compramos (compras). */
export interface TerceroDoc {
  doc_id: string
  clase:  'VENTA' | 'COMPRA'
  numero: string
  fecha:  string   // YYYY-MM-DD
  total:  number
  moneda: string
  estado: string
}

export interface TerceroSerieMes { mes: string; etiqueta: string; ventas: number; compras: number }

export interface TerceroMonedaResumen {
  moneda:       string
  ventasTotal:  number
  comprasTotal: number
  serie:        TerceroSerieMes[]
}

export interface TerceroHistorial {
  /** Todos los documentos, del más reciente al más antiguo. Incluye borradores y
   *  anulados: la lista es el registro de lo que ha pasado. */
  docs:        TerceroDoc[]
  /** Series y totales SOLO de lo que cuenta (ESTADOS_*), separadas por moneda:
   *  sumar importes de monedas distintas no significa nada. */
  porMoneda:   TerceroMonedaResumen[]
  /** Todas las monedas convertidas a la de consolidación. null si no hay moneda
   *  de consolidación, si solo hay una moneda, o si ninguna tiene tasa. */
  consolidado: TerceroMonedaResumen | null
}

// ── Productos del proveedor (pestaña Productos, requiere módulo `inventario`) ───
export interface TerceroProducto {
  producto_id: string
  codigo:      string
  nombre:      string
  unidad:      string
  stock:       number
  estado:      'ACTIVO' | 'INACTIVO'
}

// ── Cuentas por pagar del proveedor (pestaña CxP, requiere módulo `base`) ───────
export interface TerceroCxPDoc {
  doc_id:       string
  numero:       string   // descripción del gasto
  fecha:        string
  vencimiento:  string | null
  moneda:       string
  saldo:        number
  dias_vencido: number | null   // >0 vencido; null = sin fecha de vencimiento
}
export interface TerceroCxP {
  /** Saldo pendiente por moneda; no se suman monedas distintas. */
  porMoneda: { moneda: string; saldo: number }[]
  docs:      TerceroCxPDoc[]   // pendientes, del más vencido al menos
}

export interface TerceroDetalleData {
  tercero:          Tercero
  empresa_nombre:   string
  /** Módulos VISIBLES del usuario (tenant ∩ permisos), para gatear las pestañas
   *  igual que el sidebar. base = Contabilidad; inventario = Inventario. */
  tieneBase:        boolean
  tieneInventario:  boolean
  productos:        TerceroProducto[]   // vacío si el cliente no tiene inventario
  productos_count:  number
  cuentasPorPagar:  TerceroCxP | null   // null si el cliente no tiene base
  empresas:         EmpresaDestino[]
  monedas:          MonedaOpcion[]
  tasas:            Record<string, number>
  historial:        TerceroHistorial
}

type DbAdmin = ReturnType<typeof createAdminClient>

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Historial de transacciones con un tercero: lo que le hemos facturado (ventas)
 * y lo que le hemos comprado. `facturas.cliente_id` y `compras.proveedor_id`
 * guardan directamente el `tercero_id`, así que el cruce es directo.
 *
 * Sin ofertas: un presupuesto no es una transacción (puede no convertirse nunca)
 * y sumarlo inflaría los totales con dinero que no existe.
 *
 * La serie abarca del primer al último documento (no una ventana fija): un
 * tercero con dos facturas de hace un año tiene historial, y una ventana de 6
 * meses se lo enseñaría vacío.
 */
async function historialDeTercero(
  db: DbAdmin, clientId: string, terceroId: string, empresaIds: string[],
  mods: { tieneBase: boolean; tieneInventario: boolean },
): Promise<TerceroHistorial> {
  const scope = empresaIds.length ? empresaIds : ['__none__']
  // Ventas (facturas) solo con Contabilidad; compras solo con Inventario. Sin el
  // módulo, esa mitad ni se consulta: no hay nada que enseñar y no debe contar.
  const [facRes, comRes] = await Promise.all([
    mods.tieneBase
      ? db.from('facturas').select('factura_id, numero, fecha_emision, total, moneda, estado')
          .eq('client_id', clientId).eq('cliente_id', terceroId).in('empresa_id', scope)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    mods.tieneInventario
      ? db.from('compras').select('compra_id, numero, fecha, total, moneda, estado')
          .eq('client_id', clientId).eq('proveedor_id', terceroId).in('empresa_id', scope)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ])

  const docs: TerceroDoc[] = [
    ...(facRes.data ?? []).map((f: Record<string, unknown>) => ({
      doc_id: f.factura_id as string, clase: 'VENTA' as const,
      numero: (f.numero as string) ?? '—', fecha: f.fecha_emision as string,
      total: Number(f.total) || 0, moneda: f.moneda as string, estado: f.estado as string,
    })),
    ...(comRes.data ?? []).map((c: Record<string, unknown>) => ({
      doc_id: c.compra_id as string, clase: 'COMPRA' as const,
      numero: (c.numero as string) ?? '—', fecha: c.fecha as string,
      total: Number(c.total) || 0, moneda: c.moneda as string, estado: c.estado as string,
    })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha))

  if (!docs.length) return { docs: [], porMoneda: [], consolidado: null }

  // Solo lo reconocido entra en series y totales; la lista de arriba sí lo muestra todo.
  const cuentan = docs.filter(d => d.clase === 'VENTA'
    ? (ESTADOS_FACTURA_INGRESO as readonly string[]).includes(d.estado)
    : (ESTADOS_COMPRA_GASTO as readonly string[]).includes(d.estado))

  if (!cuentan.length) return { docs, porMoneda: [], consolidado: null }

  const fechas = cuentan.map(d => d.fecha).sort()
  const meses  = mesesEntre(fechas[0].slice(0, 7), fechas[fechas.length - 1].slice(0, 7))

  const serieDe = (filtro: (d: TerceroDoc) => boolean): TerceroMonedaResumen['serie'] => {
    const mapa = new Map(meses.map(m => [m.mes, { ...m, ventas: 0, compras: 0 }]))
    for (const d of cuentan) {
      if (!filtro(d)) continue
      const b = mapa.get(d.fecha.slice(0, 7))
      if (!b) continue
      if (d.clase === 'VENTA') b.ventas += d.total
      else                     b.compras += d.total
    }
    return [...mapa.values()]
  }
  const totalDe = (ds: TerceroDoc[], clase: TerceroDoc['clase']) =>
    r2(ds.filter(d => d.clase === clase).reduce((s, d) => s + d.total, 0))

  const porMoneda: TerceroMonedaResumen[] = [...new Set(cuentan.map(d => d.moneda))].sort()
    .map(moneda => {
      const ds = cuentan.filter(d => d.moneda === moneda)
      return {
        moneda,
        ventasTotal:  totalDe(ds, 'VENTA'),
        comprasTotal: totalDe(ds, 'COMPRA'),
        serie:        serieDe(d => d.moneda === moneda),
      }
    })

  // Consolidado: mismo criterio que el dashboard —convertir a la moneda marcada
  // `es_consolidacion`— pero delegando en el conversor compartido en vez de
  // recalcular factores aquí. Un documento cuya moneda no cotiza se excluye:
  // mejor un consolidado incompleto que uno inventado.
  let consolidado: TerceroMonedaResumen | null = null
  const { data: consolRow } = await db.from('monedas').select('codigo')
    .eq('client_id', clientId).eq('es_consolidacion', true).limit(1).maybeSingle()
  const consolCode: string | null = consolRow?.codigo ?? null

  if (consolCode && porMoneda.length > 1) {
    const conv = await construirConversor(db, clientId)
    const enConsol = cuentan
      .map(d => {
        const total = d.moneda === consolCode ? d.total : conv.convertir(d.total, d.moneda, consolCode)
        return total == null ? null : { ...d, total, moneda: consolCode }
      })
      .filter((d): d is TerceroDoc => d !== null)

    if (enConsol.length) {
      const mapa = new Map(meses.map(m => [m.mes, { ...m, ventas: 0, compras: 0 }]))
      for (const d of enConsol) {
        const b = mapa.get(d.fecha.slice(0, 7))
        if (!b) continue
        if (d.clase === 'VENTA') b.ventas += d.total
        else                     b.compras += d.total
      }
      consolidado = {
        moneda:       consolCode,
        ventasTotal:  totalDe(enConsol, 'VENTA'),
        comprasTotal: totalDe(enConsol, 'COMPRA'),
        serie:        [...mapa.values()].map(b => ({ ...b, ventas: r2(b.ventas), compras: r2(b.compras) })),
      }
    }
  }

  return { docs, porMoneda, consolidado }
}

const EPS = 0.005

function diasVencido(venc: string | null, hoy: string): number | null {
  if (!venc) return null
  return Math.floor((new Date(hoy).getTime() - new Date(venc).getTime()) / 86400000)
}

/** Productos que tienen a este tercero como proveedor. `products` es por cliente
 *  (no por empresa), así que no se filtra por empresa. */
async function productosDeProveedor(
  db: DbAdmin, clientId: string, terceroId: string,
): Promise<TerceroProducto[]> {
  const { data } = await db.from('products')
    .select('producto_id, codigo, nombre, unidad, stock_actual, estado')
    .eq('client_id', clientId).eq('proveedor_id', terceroId)
    .order('nombre')
  return ((data ?? []) as Record<string, unknown>[]).map(p => ({
    producto_id: p.producto_id as string,
    codigo:      (p.codigo as string) ?? '',
    nombre:      (p.nombre as string) ?? '',
    unidad:      (p.unidad as string) ?? '',
    stock:       Number(p.stock_actual) || 0,
    estado:      (p.estado as 'ACTIVO' | 'INACTIVO') ?? 'ACTIVO',
  }))
}

/**
 * Lo que se le debe a este proveedor. Misma fuente y criterio que la página
 * global de Cuentas por pagar (`cargarCuentas('PAGAR')`): gastos_cobros tipo
 * GASTO menos lo ya liquidado en su moneda (movimientos_tesoreria PAGO →
 * monto_ref). Una compra confirmada llega aquí como su gasto automático, así que
 * NO se lee `compras` (contarían dos veces).
 */
async function cuentasPorPagarDeTercero(
  db: DbAdmin, clientId: string, terceroId: string, empresaIds: string[],
): Promise<TerceroCxP> {
  const scope = empresaIds.length ? empresaIds : ['__none__']
  const { data: gastos } = await db.from('gastos_cobros')
    .select('registro_id, descripcion, fecha, vencimiento, moneda, monto')
    .eq('client_id', clientId).eq('tercero_id', terceroId).eq('tipo', 'GASTO')
    .in('empresa_id', scope)

  const filas = (gastos ?? []) as Record<string, unknown>[]
  if (!filas.length) return { porMoneda: [], docs: [] }

  const ids = filas.map(g => g.registro_id as string)
  const { data: movs } = await db.from('movimientos_tesoreria')
    .select('referencia_id, monto, monto_ref')
    .eq('client_id', clientId).eq('origen', 'PAGO').in('referencia_id', ids)

  const liquidado = new Map<string, number>()
  for (const m of (movs ?? []) as Record<string, unknown>[]) {
    const ref = m.referencia_id as string
    liquidado.set(ref, (liquidado.get(ref) ?? 0) + Number(m.monto_ref ?? m.monto))
  }

  const hoy = hoyEnTz()
  const docs: TerceroCxPDoc[] = []
  for (const g of filas) {
    const id    = g.registro_id as string
    const monto = Number(g.monto) || 0
    const saldo = monto - (liquidado.get(id) ?? 0)
    if (saldo <= EPS) continue
    const venc = (g.vencimiento as string | null) ?? null
    docs.push({
      doc_id: id, numero: (g.descripcion as string) ?? '—',
      fecha: g.fecha as string, vencimiento: venc, moneda: g.moneda as string,
      saldo: r2(saldo), dias_vencido: diasVencido(venc, hoy),
    })
  }
  docs.sort((a, b) => (b.dias_vencido ?? -Infinity) - (a.dias_vencido ?? -Infinity))

  const porMoneda = [...new Set(docs.map(d => d.moneda))].sort().map(moneda => ({
    moneda,
    saldo: r2(docs.filter(d => d.moneda === moneda).reduce((s, d) => s + d.saldo, 0)),
  }))
  return { porMoneda, docs }
}

export async function obtenerTerceroDetalle(
  tercero_id: string,
): Promise<TerceroDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  // Módulos visibles del usuario: gatean qué pestañas se pueden armar. Se calcula
  // con la misma fuente que el sidebar (accesoModulosSession = tenant ∩ permisos).
  const acceso = await accesoModulosSession(session)
  const tieneBase       = acceso.visibles.includes('base')
  const tieneInventario = acceso.visibles.includes('inventario')

  const [empresas, monedas] = await Promise.all([obtenerEmpresas(), obtenerMonedasActivas()])
  const tasas       = await mapaTasas(db, session.client_id, monedas.map(m => m.codigo))
  const empresa_ids = empresas.map(e => e.empresa_id)

  const [terRes, productos, cuentasPorPagar, historial] = await Promise.all([
    db.from('third_parties')
      .select('*')
      .eq('tercero_id', tercero_id)
      .eq('client_id', session.client_id)
      .in('empresa_id', empresa_ids.length ? empresa_ids : ['__none__'])
      .single(),
    // Solo se consulta la parte que el cliente puede ver: nada de Inventario sin
    // el módulo, nada de contabilidad sin `base`.
    tieneInventario
      ? productosDeProveedor(db, session.client_id, tercero_id)
      : Promise.resolve([] as TerceroProducto[]),
    tieneBase
      ? cuentasPorPagarDeTercero(db, session.client_id, tercero_id, empresa_ids)
      : Promise.resolve(null),
    historialDeTercero(db, session.client_id, tercero_id, empresa_ids, { tieneBase, tieneInventario }),
  ])

  if (!terRes.data) return null

  const tercero = terRes.data as Tercero
  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  return {
    tercero,
    empresa_nombre:  empresa_nombres[tercero.empresa_id] ?? tercero.empresa_id,
    tieneBase,
    tieneInventario,
    productos,
    productos_count: productos.length,
    cuentasPorPagar,
    empresas:        empresas.map(e => ({
      empresa_id: e.empresa_id, nombre: e.nombre, moneda_funcional: e.moneda_funcional,
    })),
    monedas,
    tasas,
    historial,
  }
}
