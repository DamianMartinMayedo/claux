'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'

// Catálogo de "necesidades" del diagnóstico (paso "¿Qué necesitas?").
// Curado desde /admin/diagnostico: cada opción está en lenguaje del cliente y
// mapea a uno o varios módulos del catálogo. El embudo público lo lee vía ISR.

const CLAVE_RE = /^[a-z][a-z0-9_]*$/

function revalidar() {
  revalidatePath('/admin/diagnostico')
  revalidatePath('/diagnostico')
  revalidatePath('/landing')
}

function leerCampos(formData: FormData) {
  return {
    etiqueta: ((formData.get('etiqueta') as string) ?? '').trim(),
    descripcion: ((formData.get('descripcion') as string) ?? '').trim() || null,
    icono: ((formData.get('icono') as string) ?? 'generico').trim() || 'generico',
    modulos: formData.getAll('modulos').map(String).filter(Boolean),
  }
}

// ── Crear ────────────────────────────────────────────────────────────
export async function crearNecesidad(formData: FormData) {
  const supabase = await createClient()

  const clave = ((formData.get('clave') as string) ?? '').trim()
  const { etiqueta, descripcion, icono, modulos } = leerCampos(formData)

  if (!clave || !etiqueta) return { ok: false, error: 'Clave y etiqueta son obligatorias.' }
  if (!CLAVE_RE.test(clave)) return { ok: false, error: 'Clave inválida: minúsculas, números y _.' }
  if (modulos.length === 0) return { ok: false, error: 'Selecciona al menos un módulo a recomendar.' }

  const { data: existente } = await supabase
    .from('diagnostico_necesidades')
    .select('clave')
    .eq('clave', clave)
    .maybeSingle()
  if (existente) return { ok: false, error: `La clave "${clave}" ya existe.` }

  const { count } = await supabase
    .from('diagnostico_necesidades')
    .select('*', { count: 'exact', head: true })
  const orden = (count ?? 0) + 1

  const { error } = await supabase
    .from('diagnostico_necesidades')
    .insert({ clave, etiqueta, descripcion, icono, modulos, orden, activa: true })

  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email: user?.email ?? 'sistema',
    entity: 'diagnostico_necesidad',
    entity_id: clave,
    action: 'crear',
    description: `Creó necesidad "${etiqueta}" (${clave}) → ${modulos.join(', ')}`,
  })

  revalidar()
  return { ok: true as const }
}

// ── Editar ───────────────────────────────────────────────────────────
export async function editarNecesidad(formData: FormData) {
  const supabase = await createClient()

  const clave = ((formData.get('clave') as string) ?? '').trim()
  const { etiqueta, descripcion, icono, modulos } = leerCampos(formData)
  const activa = formData.get('activa') === 'true'

  if (!clave || !etiqueta) return { ok: false, error: 'Clave y etiqueta son obligatorias.' }
  if (modulos.length === 0) return { ok: false, error: 'Selecciona al menos un módulo a recomendar.' }

  const { error } = await supabase
    .from('diagnostico_necesidades')
    .update({ etiqueta, descripcion, icono, modulos, activa, updated_at: new Date().toISOString() })
    .eq('clave', clave)

  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email: user?.email ?? 'sistema',
    entity: 'diagnostico_necesidad',
    entity_id: clave,
    action: 'editar',
    description: `Editó necesidad ${clave} — activa: ${activa} → ${modulos.join(', ')}`,
  })

  revalidar()
  return { ok: true as const }
}

// ── Eliminar ─────────────────────────────────────────────────────────
export async function eliminarNecesidad(clave: string) {
  const supabase = await createClient()

  const { error } = await supabase.from('diagnostico_necesidades').delete().eq('clave', clave)
  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email: user?.email ?? 'sistema',
    entity: 'diagnostico_necesidad',
    entity_id: clave,
    action: 'eliminar',
    description: `Eliminó necesidad ${clave}`,
  })

  revalidar()
  return { ok: true as const }
}

// ── Reordenar ────────────────────────────────────────────────────────
export async function reordenarNecesidades(claves: string[]) {
  const supabase = await createClient()

  for (let i = 0; i < claves.length; i++) {
    await supabase
      .from('diagnostico_necesidades')
      .update({ orden: i + 1 })
      .eq('clave', claves[i])
  }

  revalidar()
  return { ok: true as const }
}
