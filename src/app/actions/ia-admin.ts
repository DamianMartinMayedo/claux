'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { esDocumentoIa, defaultDocumentoIa } from '@/lib/ia/documentos'

// Acciones del panel de control de IA del admin (catálogo de modelos, límites
// globales y override de cupo por cliente). Server-only; el acceso ya está
// protegido por el layout del admin.

type Resp = { ok: true } | { ok: false; error: string }

// ── Ajustes globales: nombre/tono del agente, modelo principal, fallback, cupo ──
export async function guardarConfigIaGlobal(args: {
  nombre: string
  tono: string
  principal: string
  fallbackGratis: string
  cupo: number
}): Promise<Resp> {
  const db = createAdminClient()
  const filas = [
    { key: 'ia_nombre_agente',          value: (args.nombre || '').trim().slice(0, 40) || 'Claux' },
    { key: 'ia_tono',                   value: (args.tono || '').trim().slice(0, 80) },
    { key: 'ia_model',                  value: (args.principal || '').trim() },
    { key: 'ia_modelo_fallback_gratis', value: (args.fallbackGratis || '').trim() },
    { key: 'ia_cupo_conversaciones',    value: String(Math.max(1, Math.floor(args.cupo || 0))) },
  ]
  const { error } = await db.from('settings').upsert(
    filas.map(f => ({ ...f, updated_at: new Date().toISOString() })),
    { onConflict: 'key' },
  )
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ia')
  return { ok: true }
}

// ── Documentos de IA editables (personalidad + prompts por sección) ──
// La clave se valida contra el registro DOCUMENTOS_IA (no se permite escribir
// cualquier setting arbitrario).
export async function guardarDocumentoIa(key: string, texto: string): Promise<Resp> {
  if (!esDocumentoIa(key)) return { ok: false, error: 'Documento no válido.' }
  const valor = (texto ?? '').trim()
  if (!valor) return { ok: false, error: 'El documento no puede estar vacío.' }
  if (valor.length > 6000) return { ok: false, error: 'El documento es demasiado largo (máx. 6000 caracteres).' }
  const db = createAdminClient()
  const { error } = await db.from('settings')
    .upsert({ key, value: valor, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ia')
  return { ok: true }
}

export async function restaurarDocumentoIa(key: string): Promise<Resp> {
  const def = defaultDocumentoIa(key)
  if (def == null) return { ok: false, error: 'Documento no válido.' }
  return guardarDocumentoIa(key, def)
}

// ── Catálogo de modelos ──
export async function toggleModeloIa(id: string, activo: boolean): Promise<Resp> {
  const db = createAdminClient()
  const { error } = await db.from('ia_modelos').update({ activo }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ia')
  return { ok: true }
}

export async function crearModeloIa(args: {
  id: string; nombre: string; gratis: boolean; api_base?: string | null; api_key_env?: string | null
}): Promise<Resp> {
  const id = (args.id || '').trim()
  const nombre = (args.nombre || '').trim()
  if (!id) return { ok: false, error: 'El id del modelo es obligatorio.' }
  const db = createAdminClient()
  const { error } = await db.from('ia_modelos').insert({
    id, nombre: nombre || id, gratis: !!args.gratis,
    api_base: args.api_base?.trim() || null,
    api_key_env: args.api_key_env?.trim() || null,
    activo: true, orden: 100,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ia')
  return { ok: true }
}

export async function eliminarModeloIa(id: string): Promise<Resp> {
  const db = createAdminClient()
  const { error } = await db.from('ia_modelos').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ia')
  return { ok: true }
}

// ── Override de cupo por cliente (clients.ia_config.cupo) ──
// cupo=null/0 → quita el override y vuelve al cupo global.
export async function setCupoClienteIa(clientId: string, cupo: number | null): Promise<Resp> {
  const db = createAdminClient()
  const { data: row } = await db.from('clients').select('ia_config').eq('client_id', clientId).single()
  const actual = (row?.ia_config && typeof row.ia_config === 'object') ? row.ia_config as Record<string, unknown> : {}
  const nuevo = { ...actual }
  if (cupo && cupo > 0) nuevo.cupo = Math.floor(cupo)
  else delete nuevo.cupo

  const { error } = await db.from('clients').update({ ia_config: nuevo }).eq('client_id', clientId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/admin/clientes/${clientId}`)
  return { ok: true }
}
