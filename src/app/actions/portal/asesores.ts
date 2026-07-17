'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface Asesor {
  asesor_id:  string
  nombre:     string
  email:      string
  empresa_id: string | null   // null = vale para todas las empresas
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generarAsesorId(): string {
  return `ASE-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// ── Lectura ─────────────────────────────────────────────────────────────────────

export async function obtenerAsesores(): Promise<Asesor[]> {
  const session = await getPortalSession()
  if (!session) return []

  const db = createAdminClient()
  const { data } = await db
    .from('asesores')
    .select('asesor_id, nombre, email, empresa_id')
    .eq('client_id', session.client_id)
    .eq('activo', true)
    .order('nombre')

  return (data ?? []).map(a => ({
    asesor_id:  a.asesor_id as string,
    nombre:     a.nombre as string,
    email:      a.email as string,
    empresa_id: (a.empresa_id as string) ?? null,
  }))
}

// ── Alta / edición ──────────────────────────────────────────────────────────────
// `asesor_id` vacío = alta; con valor = edición. `empresa_id` vacío = todas.

export async function guardarAsesor(input: {
  asesor_id?:  string
  nombre:      string
  email:       string
  empresa_id?: string | null
}): Promise<{ ok: boolean; error?: string; asesor?: Asesor }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const nombre = input.nombre?.trim()
  const email  = input.email?.trim().toLowerCase()
  if (!nombre) return { ok: false, error: 'El nombre del asesor es obligatorio.' }
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'El correo no parece válido.' }

  // empresa_id vacío/null = todas; si viene, debe ser una empresa accesible.
  const empresa_id = input.empresa_id?.trim() || null
  if (empresa_id) {
    const empresas = await obtenerEmpresas()
    if (!empresas.some(e => e.empresa_id === empresa_id)) {
      return { ok: false, error: 'Empresa no válida.' }
    }
  }

  const db = createAdminClient()

  if (input.asesor_id) {
    const { error } = await db.from('asesores')
      .update({ nombre, email, empresa_id, updated_at: new Date().toISOString() })
      .eq('asesor_id', input.asesor_id).eq('client_id', session.client_id)
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'Ya tienes ese correo para ese ámbito.' }
      return { ok: false, error: 'No se pudo guardar el asesor.' }
    }
    revalidatePath('/portal/reportes'); revalidatePath('/portal/perfil')
    return { ok: true, asesor: { asesor_id: input.asesor_id, nombre, email, empresa_id } }
  }

  const asesor_id = generarAsesorId()
  const { error } = await db.from('asesores').insert({
    asesor_id, client_id: session.client_id, nombre, email, empresa_id,
  })
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Ya tienes ese correo para ese ámbito.' }
    return { ok: false, error: 'No se pudo crear el asesor.' }
  }
  revalidatePath('/portal/reportes'); revalidatePath('/portal/perfil')
  return { ok: true, asesor: { asesor_id, nombre, email, empresa_id } }
}

// ── Baja (soft delete) ────────────────────────────────────────────────────────

export async function eliminarAsesor(asesor_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { error } = await db.from('asesores')
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq('asesor_id', asesor_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo eliminar el asesor.' }

  revalidatePath('/portal/reportes'); revalidatePath('/portal/perfil')
  return { ok: true }
}
