'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'

// Codificación del ID: {Nivel}{Modalidad}{NNN}
// Nivel:    B=Básico  P=Profesional  E=Empresarial
// Modalidad: M=Mensual T=Trimestral S=Semestral A=Anual X=Personalizado
// Ejemplo: BM001, PT002, EA003
const NIVEL_CODE: Record<string, string>     = { basico: 'B', profesional: 'P', empresarial: 'E' }
const MODALIDAD_CODE: Record<string, string> = { mensual: 'M', trimestral: 'T', semestral: 'S', anual: 'A', personalizado: 'X' }

async function generarPlanId(supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>, nivel: string, modalidad: string): Promise<string> {
  const prefix = (NIVEL_CODE[nivel] ?? 'P') + (MODALIDAD_CODE[modalidad] ?? 'M')
  const { count } = await supabase.from('plans').select('*', { count: 'exact', head: true })
  let seq = (count ?? 0) + 1
  let candidato = `${prefix}${String(seq).padStart(3, '0')}`
  // Garantizar unicidad ante colisiones
  while (true) {
    const { data } = await supabase.from('plans').select('plan_id').eq('plan_id', candidato).maybeSingle()
    if (!data) break
    seq++
    candidato = `${prefix}${String(seq).padStart(3, '0')}`
  }
  return candidato
}

export async function crearPlan(formData: FormData) {
  const supabase = await createClient()

  const nombre        = ((formData.get('nombre') as string) ?? '').trim()
  const nivel         = ((formData.get('nivel') as string) ?? '').toLowerCase()
  const modalidad     = ((formData.get('modalidad') as string) ?? '').toLowerCase()
  const precio_usd    = parseFloat(formData.get('precio_usd') as string)
  const duracion_dias = parseInt(formData.get('duracion_dias') as string)
  const dias_trial    = parseInt(formData.get('dias_trial') as string)
  const max_empresas  = parseInt(formData.get('max_empresas') as string)
  const max_usuarios  = parseInt(formData.get('max_usuarios') as string)
  const modulos       = formData.getAll('modulos') as string[]
  const estado        = (formData.get('estado') as string) || 'ACTIVO'
  const visible       = formData.get('visible') === 'true'
  const descripcion   = ((formData.get('descripcion') as string) ?? '').trim() || null

  if (!nombre || isNaN(precio_usd)) {
    return { ok: false, error: 'Nombre y precio son obligatorios.' }
  }

  const plan_id = await generarPlanId(supabase, nivel, modalidad)

  const { error } = await supabase.from('plans').insert({
    plan_id,
    nombre,
    nivel,
    modalidad,
    precio_usd,
    duracion_dias: isNaN(duracion_dias) ? 30 : duracion_dias,
    dias_trial:   isNaN(dias_trial)    ? 15 : dias_trial,
    max_empresas: isNaN(max_empresas)  ? 1  : max_empresas,
    max_usuarios: isNaN(max_usuarios)  ? 2  : max_usuarios,
    modulos: modulos.length > 0 ? modulos : null,
    estado,
    visible,
    descripcion,
  })

  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'plan',
    entity_id:   plan_id,
    action:      'crear',
    description: `Creó plan "${nombre}" (${plan_id})`,
  })

  revalidatePath('/admin/planes')
  revalidatePath('/admin/dashboard')
  return { ok: true, plan_id }
}

export async function actualizarPlan(formData: FormData) {
  const supabase = await createClient()

  const plan_id      = formData.get('plan_id') as string
  const nombre       = ((formData.get('nombre') as string) ?? '').trim()
  const nivel        = ((formData.get('nivel') as string) ?? '').toLowerCase()
  const modalidad    = ((formData.get('modalidad') as string) ?? '').toLowerCase()
  const precio_usd   = parseFloat(formData.get('precio_usd') as string)
  const duracion_dias = parseInt(formData.get('duracion_dias') as string)
  const dias_trial   = parseInt(formData.get('dias_trial') as string)
  const max_empresas = parseInt(formData.get('max_empresas') as string)
  const max_usuarios = parseInt(formData.get('max_usuarios') as string)
  // Guardar como ARRAY (igual que crearPlan); el portal espera array. Antes se guardaba
  // CSV aquí y rompía el gating al editar un plan. Ver docs/MODELO-MODULOS.md §9 D1.
  const modulos      = formData.getAll('modulos') as string[]
  const estado       = formData.get('estado') as string
  const visible      = formData.get('visible') === 'true'
  const descripcion  = ((formData.get('descripcion') as string) ?? '').trim() || null

  if (!plan_id || !nombre || isNaN(precio_usd)) {
    return { ok: false, error: 'Datos incompletos.' }
  }

  const { error } = await supabase
    .from('plans')
    .update({
      nombre,
      nivel,
      modalidad,
      precio_usd,
      duracion_dias: isNaN(duracion_dias) ? 30 : duracion_dias,
      dias_trial:   isNaN(dias_trial)    ? 0  : dias_trial,
      max_empresas: isNaN(max_empresas)  ? 1  : max_empresas,
      max_usuarios: isNaN(max_usuarios)  ? 2  : max_usuarios,
      modulos: modulos.length > 0 ? modulos : null,
      estado,
      visible,
      descripcion,
    })
    .eq('plan_id', plan_id)

  if (error) return { ok: false, error: error.message }

  const { data: { user: u2 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  u2?.email ?? 'sistema',
    entity:      'plan',
    entity_id:   plan_id,
    action:      'editar',
    description: `Editó plan "${nombre}" (${plan_id})`,
  })

  revalidatePath('/admin/planes')
  revalidatePath('/admin/dashboard')
  return { ok: true }
}

// ── Duplicar plan ────────────────────────────────────────────────────
export async function duplicarPlan(planId: string) {
  const supabase = await createClient()

  const { data: plan } = await supabase
    .from('plans').select('*').eq('plan_id', planId).single()
  if (!plan) return { ok: false as const, error: 'Plan no encontrado.' }

  const { count } = await supabase
    .from('plans').select('*', { count: 'exact', head: true })
  const nuevoPlanId = `PLAN-${String((count ?? 0) + 1).padStart(3, '0')}`

  const { error } = await supabase.from('plans').insert({
    ...plan,
    plan_id:  nuevoPlanId,
    nombre:   `Copia de ${plan.nombre}`,
    estado:   'INACTIVO',
    visible:  false,
  })
  if (error) return { ok: false as const, error: error.message }

  const { data: { user: u3 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  u3?.email ?? 'sistema',
    entity:      'plan',
    entity_id:   nuevoPlanId,
    action:      'duplicar',
    description: `Duplicó plan "${plan.nombre}" → nuevo plan ${nuevoPlanId}`,
  })

  revalidatePath('/admin/planes')
  return { ok: true as const, nuevoPlanId }
}

// ── Eliminar plan ────────────────────────────────────────────────────
// Bloquea si algún cliente usa el plan.
export async function eliminarPlan(planId: string) {
  const supabase = await createClient()

  const { count } = await supabase
    .from('clients').select('*', { count: 'exact', head: true }).eq('plan_id', planId)

  if (count && count > 0) {
    return {
      ok: false as const,
      error: `No se puede eliminar: ${count} cliente${count !== 1 ? 's' : ''} usa${count !== 1 ? 'n' : ''} este plan.`,
    }
  }

  const { error } = await supabase.from('plans').delete().eq('plan_id', planId)
  if (error) return { ok: false as const, error: error.message }

  const { data: { user: u4 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  u4?.email ?? 'sistema',
    entity:      'plan',
    entity_id:   planId,
    action:      'eliminar',
    description: `Eliminó plan ${planId}`,
  })

  revalidatePath('/admin/planes')
  revalidatePath('/admin/dashboard')
  return { ok: true as const }
}
