'use server'

import { requirePermiso } from '@/lib/admin-guard'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuthBypassed } from '@/lib/dev-auth'
import { revalidatePath } from 'next/cache'
import { renderPlantilla } from '@/lib/email/render'
import { enviarEmail, tipoEmailActivo } from '@/lib/email/enviar'

// Guard: el admin debe estar autenticado (o bypass en dev). Los datos se leen/escriben
// con service_role, igual que el resto de la plataforma.
async function adminAutenticado(): Promise<boolean> {
  if (isAuthBypassed()) return true
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  return !!user
}

// ── Mensajes ────────────────────────────────────────────────────────────────

export interface MensajeSoporte {
  id:             number
  client_id:      string
  user_id:        string | null
  nombre_empresa: string
  email:          string | null
  asunto:         string
  mensaje:        string
  estado:         'NUEVO' | 'LEIDO' | 'RESUELTO'
  respuesta:      string | null
  respuesta_at:   string | null
  created_at:     string
  /**
   * Solo lo traen los mensajes nacidos del banner de captación del dashboard:
   * es una OPORTUNIDAD DE VENTA, no una incidencia, y se atiende distinto.
   */
  modulo_clave:   string | null
}

export async function listarMensajesSoporte(): Promise<MensajeSoporte[]> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return []
  const db = createAdminClient()

  const { data: msgs } = await db
    .from('soporte_mensajes')
    .select('id, client_id, user_id, email, asunto, mensaje, estado, respuesta, respuesta_at, created_at, modulo_clave')
    .order('created_at', { ascending: false })

  const ids = [...new Set((msgs ?? []).map(m => m.client_id))]
  const { data: clientes } = await db
    .from('clients')
    .select('client_id, nombre_empresa')
    .in('client_id', ids.length ? ids : ['__none__'])
  const nombre = new Map((clientes ?? []).map(c => [c.client_id, c.nombre_empresa]))

  return (msgs ?? []).map(m => ({
    ...m,
    nombre_empresa: nombre.get(m.client_id) ?? m.client_id,
  })) as MensajeSoporte[]
}

// ── Ampliaciones: lo mismo, visto desde VENTAS ──────────────────────────────
//
// Un cliente que pide activar un módulo NO es un lead del diagnóstico: no tiene
// teléfono ni «modo actual» (el formulario público sí los exige) y ya es cliente.
// Por eso no se copia a `diagnosticos`; se lee la MISMA fila de `soporte_mensajes`
// desde la sección de Ventas, filtrando por `modulo_clave`. Una fila, dos vistas:
// soporte la ve como mensaje y ventas como oportunidad, sin duplicar el dato.
//
// El candado es `solicitudes` —el permiso que ya tiene el rol de ventas—, no
// `soporte`: ver las ampliaciones no debe abrirle toda la bandeja de incidencias.

export interface Ampliacion {
  id:             number
  client_id:      string
  nombre_empresa: string
  /** Persona de contacto del cliente, para saber a quién se llama. */
  contacto:       string | null
  /** Quién lo pidió desde el portal. */
  email:          string | null
  modulo_clave:   string
  /** Nombre comercial del módulo (catálogo). Si no está, se cae a la clave. */
  modulo:         string
  estado:         'NUEVO' | 'LEIDO' | 'RESUELTO'
  created_at:     string
}

export async function listarAmpliaciones(): Promise<Ampliacion[]> {
  await requirePermiso('solicitudes')
  if (!(await adminAutenticado())) return []
  const db = createAdminClient()

  const { data: msgs } = await db
    .from('soporte_mensajes')
    .select('id, client_id, email, modulo_clave, estado, created_at')
    .not('modulo_clave', 'is', null)
    .order('created_at', { ascending: false })

  const ids = [...new Set((msgs ?? []).map(m => m.client_id))]
  const [{ data: clientes }, { data: catalogo }] = await Promise.all([
    db.from('clients').select('client_id, nombre_empresa, nombre_contacto')
      .in('client_id', ids.length ? ids : ['__none__']),
    db.from('modulos_catalogo').select('clave, nombre'),
  ])
  const cliente = new Map((clientes ?? []).map(c => [c.client_id, c]))
  const nombreModulo = new Map((catalogo ?? []).map(c => [c.clave, c.nombre]))

  return (msgs ?? []).map(m => ({
    id:             m.id as number,
    client_id:      m.client_id as string,
    nombre_empresa: cliente.get(m.client_id)?.nombre_empresa ?? m.client_id,
    contacto:       cliente.get(m.client_id)?.nombre_contacto ?? null,
    email:          m.email as string | null,
    modulo_clave:   m.modulo_clave as string,
    modulo:         nombreModulo.get(m.modulo_clave as string) ?? (m.modulo_clave as string),
    estado:         m.estado as Ampliacion['estado'],
    created_at:     m.created_at as string,
  }))
}

/** Mismo cambio de estado que en soporte, con el candado de ventas. */
export async function actualizarEstadoAmpliacion(
  id: number,
  estado: 'NUEVO' | 'LEIDO' | 'RESUELTO',
): Promise<{ ok: boolean }> {
  await requirePermiso('solicitudes')
  if (!(await adminAutenticado())) return { ok: false }
  if (!['NUEVO', 'LEIDO', 'RESUELTO'].includes(estado)) return { ok: false }
  const { error } = await createAdminClient()
    .from('soporte_mensajes')
    .update({ estado })
    .eq('id', id)
    .not('modulo_clave', 'is', null)   // desde ventas solo se tocan ampliaciones
  if (error) return { ok: false }
  revalidatePath('/admin/ventas/ampliaciones')
  revalidatePath('/admin/soporte')
  return { ok: true }
}

export async function actualizarEstadoMensaje(
  id: number,
  estado: 'NUEVO' | 'LEIDO' | 'RESUELTO',
): Promise<{ ok: boolean }> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return { ok: false }
  if (!['NUEVO', 'LEIDO', 'RESUELTO'].includes(estado)) return { ok: false }
  const { error } = await createAdminClient()
    .from('soporte_mensajes')
    .update({ estado })
    .eq('id', id)
  if (error) return { ok: false }
  revalidatePath('/admin/soporte')
  return { ok: true }
}

// ── FAQ (CRUD) ──────────────────────────────────────────────────────────────

export interface FaqAdmin {
  id:           number
  modulo_clave: string
  pregunta:     string
  respuesta:    string
  orden:        number
  activo:       boolean
}

export async function listarFaqAdmin(): Promise<FaqAdmin[]> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return []
  const { data } = await createAdminClient()
    .from('soporte_faq')
    .select('id, modulo_clave, pregunta, respuesta, orden, activo')
    .order('modulo_clave')
    .order('orden')
  return (data ?? []) as FaqAdmin[]
}

export async function guardarFaq(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return { ok: false, error: 'No autorizado.' }

  const id           = ((formData.get('id')           as string) ?? '').trim()
  const modulo_clave = ((formData.get('modulo_clave') as string) ?? 'general').trim() || 'general'
  const pregunta     = ((formData.get('pregunta')     as string) ?? '').trim()
  const respuesta    = ((formData.get('respuesta')    as string) ?? '').trim()
  const orden        = parseInt((formData.get('orden') as string) ?? '0', 10) || 0
  const activo       = formData.get('activo') !== 'false'

  if (!pregunta)  return { ok: false, error: 'La pregunta es obligatoria.' }
  if (!respuesta) return { ok: false, error: 'La respuesta es obligatoria.' }

  const db = createAdminClient()
  if (id) {
    const { error } = await db.from('soporte_faq')
      .update({ modulo_clave, pregunta, respuesta, orden, activo, updated_at: new Date().toISOString() })
      .eq('id', Number(id))
    if (error) return { ok: false, error: 'Error al guardar la pregunta.' }
  } else {
    const { error } = await db.from('soporte_faq')
      .insert({ modulo_clave, pregunta, respuesta, orden, activo })
    if (error) return { ok: false, error: 'Error al crear la pregunta.' }
  }
  revalidatePath('/admin/soporte')
  return { ok: true }
}

export async function eliminarFaq(id: number): Promise<{ ok: boolean }> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return { ok: false }
  const { error } = await createAdminClient().from('soporte_faq').delete().eq('id', id)
  if (error) return { ok: false }
  revalidatePath('/admin/soporte')
  return { ok: true }
}

// ── Responder un mensaje de soporte ──────────────────────────────────────────
// Guarda la respuesta en el propio mensaje, lo marca RESUELTO y envía un email
// al cliente (from soporte@, Reply-To: soporte@) con el texto del admin dentro
// de la plantilla `respuesta_soporte` (marco de marca ya incluido).
export async function responderMensajeSoporte(
  id: number,
  texto: string,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return { ok: false, error: 'No autorizado.' }

  const respuesta = texto.trim()
  if (!respuesta) return { ok: false, error: 'La respuesta no puede estar vacía.' }

  const db = createAdminClient()
  const { data: msg } = await db
    .from('soporte_mensajes')
    .select('client_id, user_id, email, asunto')
    .eq('id', id)
    .maybeSingle()
  if (!msg) return { ok: false, error: 'Mensaje no encontrado.' }

  const { error } = await db
    .from('soporte_mensajes')
    .update({ respuesta, respuesta_at: new Date().toISOString(), estado: 'RESUELTO' })
    .eq('id', id)
  if (error) return { ok: false, error: 'No se pudo guardar la respuesta.' }

  if (msg.email && await tipoEmailActivo('respuesta_soporte')) {
    let nombre = msg.email
    if (msg.user_id) {
      const { data: usuario } = await db
        .from('client_users').select('nombre').eq('user_id', msg.user_id).maybeSingle()
      if (usuario?.nombre) nombre = usuario.nombre
    }
    const { asunto, html } = await renderPlantilla('respuesta_soporte', {
      nombre,
      asunto: msg.asunto,
      mensaje_admin: respuesta,
    })
    await enviarEmail({
      to: msg.email,
      from: 'CLAUX Soporte <soporte@claux.es>',
      replyTo: 'soporte@claux.es',
      subject: asunto,
      html,
      tipo: 'respuesta_soporte',
      clientId: msg.client_id,
    })
  }

  revalidatePath('/admin/soporte')
  return { ok: true }
}
