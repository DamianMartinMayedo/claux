'use server'

import { createAdminClient } from '@/lib/supabase/admin'

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
