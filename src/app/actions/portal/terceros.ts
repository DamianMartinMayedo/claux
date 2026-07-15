'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type TipoTercero   = 'CLIENTE' | 'PROVEEDOR' | 'AMBOS'
export type CondicionPago = 'CONTADO' | '15' | '30' | '60' | '90'

export interface ViaPago {
  tipo:         string
  // Transferencia nacional
  titular?:     string
  cuenta?:      string
  banco?:       string
  tipo_cuenta?: string        // Corriente | Ahorro
  // Internacional (extras)
  swift?:       string
  routing?:     string
  moneda?:      string
  id_titular?:  string
  telefono?:    string
  direccion?:   string
  // Pago Móvil
  cedula?:      string
  // Zelle
  nombre?:      string
  contacto?:    string        // teléfono o email
  // TropiPay
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

// ── Obtener terceros ──────────────────────────────────────────────────────────

export async function obtenerTerceros(): Promise<TercerosPageData> {
  const session = await getPortalSession()
  if (!session) return { terceros: [], empresa_nombres: {} }

  const db = createAdminClient()
  const empresas = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)

  if (!empresa_ids.length) return { terceros: [], empresa_nombres: {} }

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
  }
}

// ── Guardar (crear / actualizar) ──────────────────────────────────────────────

export async function guardarTercero(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; tercero_id?: string }> {
  const session = await getPortalSession()
  if (!session)          return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

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
    moneda_defecto:         ((formData.get('moneda_defecto')  as string) ?? '').trim() || null,
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
export async function copiarTerceroAEmpresa(
  tercero_id: string,
  empresa_destino: string,
): Promise<{ ok: boolean; error?: string; tercero_id?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

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

  const nuevo_id = generarTerceroId()
  const ahora    = new Date().toISOString()
  const { error } = await db.from('third_parties').insert({
    ...src,
    tercero_id: nuevo_id,
    empresa_id: empresa_destino,
    activo:     true,
    created_at: ahora,
    updated_at: ahora,
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
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

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
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

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

// ── Detalle de tercero ────────────────────────────────────────────────────────

export interface TerceroDetalleData {
  tercero:          Tercero
  empresa_nombre:   string
  productos_count:  number   // cuántos productos tiene asignado este proveedor
  empresas:         { empresa_id: string; nombre: string }[]
}

export async function obtenerTerceroDetalle(
  tercero_id: string,
): Promise<TerceroDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const empresas = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)

  const [terRes, prodCountRes] = await Promise.all([
    db.from('third_parties')
      .select('*')
      .eq('tercero_id', tercero_id)
      .eq('client_id', session.client_id)
      .in('empresa_id', empresa_ids.length ? empresa_ids : ['__none__'])
      .single(),
    db.from('products')
      .select('producto_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id)
      .eq('proveedor_id', tercero_id),
  ])

  if (!terRes.data) return null

  const tercero = terRes.data as Tercero
  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  return {
    tercero,
    empresa_nombre:  empresa_nombres[tercero.empresa_id] ?? tercero.empresa_id,
    productos_count: prodCountRes.count ?? 0,
    empresas:        empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
  }
}
