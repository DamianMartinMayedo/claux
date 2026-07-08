'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-guard'

export type EstadoLead = 'nuevo' | 'contactado'

export interface DiagnosticoLead {
  id: number
  nombre: string
  telefono: string
  email: string | null
  sector: string
  necesidades: string[]
  modo_actual: string
  modulos_rec: string[]
  estado: EstadoLead
  created_at: string
}

// Lista de solicitudes de diagnóstico (leads) para el admin. El guardado lo hace
// el público por service_role; listarlas solo puede un admin autorizado.
export async function listarDiagnosticos(): Promise<DiagnosticoLead[]> {
  await requireAdmin()
  const db = createAdminClient()
  const { data } = await db
    .from('diagnosticos')
    .select('id, nombre, telefono, email, sector, necesidades, modo_actual, modulos_rec, estado, created_at')
    .order('created_at', { ascending: false })
  return (data ?? []) as DiagnosticoLead[]
}

// Marcar una solicitud como 'nuevo' o 'contactado'.
export async function actualizarEstadoDiagnostico(
  id: number,
  estado: EstadoLead,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  if (estado !== 'nuevo' && estado !== 'contactado') return { ok: false, error: 'Estado inválido.' }
  const db = createAdminClient()
  const { error } = await db.from('diagnosticos').update({ estado }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

interface GuardarDiagnosticoInput {
  nombre: string
  telefono: string
  email: string
  sector: string
  necesidades: string[]
  modoActual: string
  modulosRec: string[]
}

export async function guardarDiagnostico(
  input: GuardarDiagnosticoInput
): Promise<{ ok: boolean; error?: string }> {
  const { nombre, telefono, email, sector, necesidades, modoActual, modulosRec } = input

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!nombre.trim() || !telefono.trim() || !email.trim() || !sector || !modoActual) {
    return { ok: false, error: 'Faltan datos obligatorios.' }
  }
  if (!EMAIL_RE.test(email.trim())) {
    return { ok: false, error: 'Correo no válido.' }
  }

  const db = createAdminClient()

  const { error } = await db.from('diagnosticos').insert({
    nombre: nombre.trim(),
    telefono: telefono.trim(),
    email: email.trim() || null,
    sector,
    necesidades,
    modo_actual: modoActual,
    modulos_rec: modulosRec,
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true }
}
