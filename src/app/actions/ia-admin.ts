'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermiso } from '@/lib/admin-guard'
import { esDocumentoIa, defaultDocumentoIa } from '@/lib/ia/documentos'
import { esFuncionIa, type FnIa } from '@/lib/ia/funciones'

// Acciones del panel de control de IA del admin (catálogo de modelos, límites
// globales y override de cupo por cliente). Server-only; el acceso ya está
// protegido por el layout del admin.

type Resp = { ok: true } | { ok: false; error: string }

// ── Ajustes globales: nombre/tono del agente, modelo principal, fallback, cupo ──
// y la bolsa INTERNA (mig. 235), que es dinero nuestro y no del cliente: qué modelo
// usa el equipo desde /admin y cuántas conversaciones al mes estamos dispuestos a
// pagar. Van en el mismo formulario porque se deciden mirando lo mismo.
export async function guardarConfigIaGlobal(args: {
  nombre: string
  tono: string
  principal: string
  fallbackGratis: string
  cupo: number
  /** '' = el equipo usa el mismo modelo principal que los clientes. */
  modeloInterno: string
  /** 0 = apagar la IA interna. */
  cupoInterno: number
}): Promise<Resp> {
  await requirePermiso('ia')
  const db = createAdminClient()

  // El interno se valida contra el catálogo, igual que el de un nivel: el
  // desplegable solo ofrece activos, pero el formulario puede llevar rato abierto.
  const interno = (args.modeloInterno || '').trim()
  if (interno) {
    const { data: m } = await db.from('ia_modelos').select('id, activo').eq('id', interno).maybeSingle()
    if (!m?.activo) return { ok: false, error: `El modelo «${interno}» ya no está disponible.` }
  }

  const filas = [
    { key: 'ia_nombre_agente',          value: (args.nombre || '').trim().slice(0, 40) || 'Claux' },
    { key: 'ia_tono',                   value: (args.tono || '').trim().slice(0, 80) },
    { key: 'ia_model',                  value: (args.principal || '').trim() },
    { key: 'ia_modelo_fallback_gratis', value: (args.fallbackGratis || '').trim() },
    { key: 'ia_cupo_conversaciones',    value: String(Math.max(1, Math.floor(args.cupo || 0))) },
    { key: 'ia_model_interno',          value: interno },
    // Aquí el 0 SÍ vale: es la forma de apagar la IA interna sin tocar código.
    { key: 'ia_cupo_interno_mes',       value: String(Math.max(0, Math.floor(args.cupoInterno || 0))) },
  ]
  const { error } = await db.from('settings').upsert(
    filas.map(f => ({ ...f, updated_at: new Date().toISOString() })),
    { onConflict: 'key' },
  )
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ia')
  return { ok: true }
}

// ── El interruptor de la IA interna ──
// Aparte de `guardarConfigIaGlobal` a propósito: un interruptor se guarda al
// pulsarlo, no al pulsar «Guardar». Uno que espera al pie deja la duda de si está
// apagada o solo pendiente, y esa duda es justo la que el interruptor venía a
// quitar. Se guarda lo APAGADO (no lo encendido) para que una función nueva nazca
// encendida sin tener que reescribir el ajuste.
export async function guardarInterruptoresIa(args: {
  activa: boolean
  apagadas: string[]
}): Promise<Resp> {
  await requirePermiso('ia')
  const db = createAdminClient()
  // Solo claves del catálogo: una clave inventada no apagaría nada y se quedaría
  // ahí para siempre confundiendo al siguiente que lea el ajuste.
  const apagadas: FnIa[] = [...new Set((args.apagadas ?? []).filter(esFuncionIa))]
  const { error } = await db.from('settings').upsert([
    { key: 'ia_interna_activa', value: args.activa ? '1' : '0', updated_at: new Date().toISOString() },
    { key: 'ia_funciones_off',  value: JSON.stringify(apagadas), updated_at: new Date().toISOString() },
  ], { onConflict: 'key' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ia')
  return { ok: true }
}

// ── Documentos de IA editables (personalidad + prompts por sección) ──
// La clave se valida contra el registro DOCUMENTOS_IA (no se permite escribir
// cualquier setting arbitrario).
export async function guardarDocumentoIa(key: string, texto: string): Promise<Resp> {
  await requirePermiso('ia')
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
  await requirePermiso('ia')
  const def = defaultDocumentoIa(key)
  if (def == null) return { ok: false, error: 'Documento no válido.' }
  return guardarDocumentoIa(key, def)
}

// ── Catálogo de modelos ──

// El health-check de un modelo NO vive aquí: es un route handler
// (`src/app/api/admin/ia/probar/route.ts`). Las server actions se despachan de una en
// una por cliente, así que una prueba lenta dejaba en cola el activar y el guardar de
// esta misma pantalla. Los tipos son los de `@/lib/ia/prueba-tipos`.

export async function toggleModeloIa(id: string, activo: boolean): Promise<Resp> {
  await requirePermiso('ia')
  const db = createAdminClient()
  const { error } = await db.from('ia_modelos').update({ activo }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ia')
  return { ok: true }
}

/** Tarifa en USD por millón de tokens. Vacío o 0 = sin tarifa (no se estima coste). */
function precio(v: unknown): number | null {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function crearModeloIa(args: {
  id: string; nombre: string; gratis: boolean; api_base?: string | null; api_key_env?: string | null; api_key?: string | null
  precioIn?: string | number | null; precioOut?: string | number | null
}): Promise<Resp> {
  await requirePermiso('ia')
  const id = (args.id || '').trim()
  const nombre = (args.nombre || '').trim()
  if (!id) return { ok: false, error: 'El id del modelo es obligatorio.' }
  const db = createAdminClient()
  const { error } = await db.from('ia_modelos').insert({
    id, nombre: nombre || id, gratis: !!args.gratis,
    api_base: args.api_base?.trim() || null,
    api_key_env: args.api_key_env?.trim() || null,
    precio_in: precio(args.precioIn), precio_out: precio(args.precioOut),
    activo: true, orden: 100,
  })
  if (error) return { ok: false, error: error.message }
  // La clave, si la hay, se guarda cifrada en Vault (nunca en la tabla).
  const key = (args.api_key || '').trim()
  if (key) {
    const { error: e2 } = await db.rpc('ia_key_set', { p_id: id, p_key: key })
    if (e2) return { ok: false, error: `Modelo creado, pero no se pudo guardar la clave: ${e2.message}` }
  }
  revalidatePath('/admin/ia')
  return { ok: true }
}

// Edita un modelo existente. El id NO se cambia (es la referencia del proveedor y la
// del secreto en Vault). La clave: si viene texto se guarda/reemplaza; si quitarKey es
// true se borra; si viene vacía y quitarKey false, se deja como está (no se toca).
export async function editarModeloIa(args: {
  id: string; nombre: string; gratis: boolean
  api_base?: string | null; api_key_env?: string | null
  api_key?: string | null; quitarKey?: boolean
  precioIn?: string | number | null; precioOut?: string | number | null
}): Promise<Resp> {
  await requirePermiso('ia')
  const id = (args.id || '').trim()
  if (!id) return { ok: false, error: 'El id del modelo es obligatorio.' }
  const db = createAdminClient()
  const { error } = await db.from('ia_modelos').update({
    nombre: (args.nombre || '').trim() || id,
    gratis: !!args.gratis,
    api_base: args.api_base?.trim() || null,
    api_key_env: args.api_key_env?.trim() || null,
    precio_in: precio(args.precioIn), precio_out: precio(args.precioOut),
  }).eq('id', id)
  if (error) return { ok: false, error: error.message }

  const key = (args.api_key || '').trim()
  if (args.quitarKey) {
    const { error: e2 } = await db.rpc('ia_key_delete', { p_id: id })
    if (e2) return { ok: false, error: `Guardado, pero no se pudo quitar la clave: ${e2.message}` }
  } else if (key) {
    const { error: e2 } = await db.rpc('ia_key_set', { p_id: id, p_key: key })
    if (e2) return { ok: false, error: `Guardado, pero no se pudo guardar la clave: ${e2.message}` }
  }
  revalidatePath('/admin/ia')
  return { ok: true }
}

export async function eliminarModeloIa(id: string): Promise<Resp> {
  await requirePermiso('ia')
  const db = createAdminClient()
  // Borra primero el secreto en Vault (si lo hay) para no dejarlo huérfano.
  await db.rpc('ia_key_delete', { p_id: id })
  const { error } = await db.from('ia_modelos').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/ia')
  return { ok: true }
}

// ── Override de cupo por cliente (clients.ia_config.cupo) ──
// cupo=null/0 → quita el override y vuelve al cupo global.
export async function setCupoClienteIa(clientId: string, cupo: number | null): Promise<Resp> {
  await requirePermiso('ia')
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
