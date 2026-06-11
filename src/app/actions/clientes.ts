'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'

// ── Utilidades de seguridad ──────────────────────────────────────────
async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + salt)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function generatePassword(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function generateSalt(): string {
  return crypto.randomUUID()
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ── Crear cliente ────────────────────────────────────────────────────
export async function crearCliente(formData: FormData) {
  const supabase = await createClient()

  const nombre_empresa  = (formData.get('nombre_empresa')  as string ?? '').trim()
  const nombre_contacto = (formData.get('nombre_contacto') as string ?? '').trim()
  const email_admin     = (formData.get('email_admin')     as string ?? '').trim().toLowerCase()
  const plan_id         = formData.get('plan_id') as string
  const notas           = (formData.get('notas')           as string ?? '').trim() || null
  const es_trial        = formData.get('es_trial') === 'true'

  if (!nombre_empresa || !email_admin || !plan_id) {
    return { ok: false, error: 'Nombre de empresa, email y plan son obligatorios.' }
  }

  // Verificar email único
  const { data: emailExiste } = await supabase
    .from('clients')
    .select('client_id')
    .eq('email_admin', email_admin)
    .maybeSingle()
  if (emailExiste) return { ok: false, error: 'Ya existe un cliente con ese email.' }

  // Resolver plan
  const { data: plan } = await supabase
    .from('plans')
    .select('dias_trial, duracion_dias')
    .eq('plan_id', plan_id)
    .single()
  if (!plan) return { ok: false, error: 'Plan no encontrado.' }

  // Calcular estado y expiración
  const estadoInicial = es_trial ? 'TRIAL' : 'ACTIVO'
  const diasVigencia  = es_trial
    ? (plan.dias_trial    ?? 15)
    : (plan.duracion_dias ?? 30)

  // Generar client_id secuencial
  const { count } = await supabase.from('clients').select('*', { count: 'exact', head: true })
  const client_id = `CLI-${String((count ?? 0) + 1).padStart(4, '0')}`

  const hoy = new Date()
  const fechaExpiracion = addDays(hoy, diasVigencia)

  const { error: errorCliente } = await supabase.from('clients').insert({
    client_id,
    nombre_empresa,
    nombre_contacto: nombre_contacto || null,
    email_admin,
    plan_id,
    fecha_inicio:     toDateStr(hoy),
    fecha_expiracion: toDateStr(fechaExpiracion),
    estado:           estadoInicial,
    notas,
  })

  if (errorCliente) return { ok: false, error: errorCliente.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'crear',
    description: `Creó cliente ${nombre_empresa} (${client_id}) — Plan: ${plan_id} — Estado: ${estadoInicial}`,
  })

  // Crear usuario admin inicial del cliente
  const passwordTemporal = generatePassword()
  const salt             = generateSalt()
  const password_hash    = await hashPassword(passwordTemporal, salt)
  const user_id          = `${client_id}-U001`

  await supabase.from('client_users').insert({
    user_id,
    client_id,
    nombre:              nombre_contacto || nombre_empresa,
    email:               email_admin,
    password_hash,
    salt,
    rol:                 'admin_empresa',
    must_change_password: true,
    estado:              'ACTIVO',
  })

  revalidatePath('/admin/clientes')
  revalidatePath('/admin/dashboard')
  return { ok: true, client_id, passwordTemporal }
}

// ── Cambiar plan ─────────────────────────────────────────────────────
export async function cambiarPlan(formData: FormData) {
  const supabase = await createClient()

  const client_id   = formData.get('client_id') as string
  const nuevo_plan  = formData.get('plan_id')   as string

  if (!client_id || !nuevo_plan) {
    return { ok: false, error: 'Datos incompletos.' }
  }

  const { data: plan } = await supabase
    .from('plans')
    .select('duracion_dias')
    .eq('plan_id', nuevo_plan)
    .single()
  if (!plan) return { ok: false, error: 'Plan no encontrado.' }

  const nuevaExpiracion = addDays(new Date(), plan.duracion_dias ?? 30)

  const { error } = await supabase
    .from('clients')
    .update({
      plan_id:          nuevo_plan,
      fecha_expiracion: toDateStr(nuevaExpiracion),
    })
    .eq('client_id', client_id)

  if (error) return { ok: false, error: error.message }

  const { data: { user: u2 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  u2?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'cambiar_plan',
    description: `Cambió plan del cliente ${client_id} a ${nuevo_plan}`,
  })

  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  revalidatePath('/admin/dashboard')
  return { ok: true as const }
}

// ── Cambiar estado (ACTIVO ↔ SUSPENDIDO) ────────────────────────────
export async function cambiarEstadoCliente(formData: FormData) {
  const supabase = await createClient()

  const client_id    = formData.get('client_id') as string
  const nuevo_estado = formData.get('estado')    as string

  if (!client_id || !['ACTIVO', 'SUSPENDIDO'].includes(nuevo_estado)) {
    return { ok: false, error: 'Datos inválidos.' }
  }

  // Leer fecha_expiracion actual para generar advertencia al reactivar
  const { data: clienteActual } = await supabase
    .from('clients')
    .select('fecha_expiracion')
    .eq('client_id', client_id)
    .single()

  const { error } = await supabase
    .from('clients')
    .update({ estado: nuevo_estado })
    .eq('client_id', client_id)

  if (error) return { ok: false, error: error.message }

  // Advertencia: reactivado pero la fecha de expiración ya venció
  let advertencia: string | null = null
  if (nuevo_estado === 'ACTIVO' && clienteActual?.fecha_expiracion) {
    const exp = new Date(clienteActual.fecha_expiracion)
    if (exp < new Date()) {
      advertencia = 'El cliente fue reactivado pero su fecha de expiración ya venció. Registra un pago para renovarla.'
    }
  }

  const { data: { user: u3 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  u3?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'cambiar_estado',
    description: `Cambió estado del cliente ${client_id} a ${nuevo_estado}`,
  })

  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  revalidatePath('/admin/dashboard')
  return { ok: true as const, advertencia }
}

// ── Aplicar período especial (GRACIA) ────────────────────────────────
export async function aplicarGracia(formData: FormData) {
  const supabase = await createClient()

  const client_id = formData.get('client_id') as string
  const dias      = parseInt(formData.get('dias') as string)
  const motivo    = (formData.get('motivo') as string ?? '').trim()
  const notas     = (formData.get('notas')  as string ?? '').trim() || null

  if (!client_id || isNaN(dias) || dias < 1 || dias > 180) {
    return { ok: false, error: 'Los días deben estar entre 1 y 180.' }
  }
  if (!motivo) {
    return { ok: false, error: 'El motivo es obligatorio.' }
  }

  const fechaGracia = addDays(new Date(), dias)

  const { error } = await supabase
    .from('clients')
    .update({
      estado:           'GRACIA',
      fecha_fin_gracia:  toDateStr(fechaGracia),
      motivo_gracia:     motivo,
      notas_gracia:      notas,
    })
    .eq('client_id', client_id)

  if (error) return { ok: false, error: error.message }

  const { data: { user: u4 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  u4?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'gracia',
    description: `Aplicó período especial al cliente ${client_id} — ${dias} días — Motivo: ${motivo}`,
  })

  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  revalidatePath('/admin/dashboard')
  return { ok: true as const, hasta: toDateStr(fechaGracia) }
}

// ── Editar datos del cliente ──────────────────────────────────────────
export async function editarCliente(formData: FormData) {
  const supabase = await createClient()

  const client_id       = (formData.get('client_id')       as string ?? '').trim()
  const nombre_empresa  = (formData.get('nombre_empresa')  as string ?? '').trim()
  const nombre_contacto = (formData.get('nombre_contacto') as string ?? '').trim() || null
  const email_admin     = (formData.get('email_admin')     as string ?? '').trim().toLowerCase()
  const notas           = (formData.get('notas')           as string ?? '').trim() || null

  if (!client_id || !nombre_empresa || !email_admin) {
    return { ok: false, error: 'Nombre de empresa y email son obligatorios.' }
  }

  // Verificar que el email no lo use otro cliente
  const { data: otro } = await supabase
    .from('clients')
    .select('client_id')
    .eq('email_admin', email_admin)
    .neq('client_id', client_id)
    .maybeSingle()
  if (otro) return { ok: false, error: 'Ese email ya está en uso por otro cliente.' }

  const { error } = await supabase
    .from('clients')
    .update({ nombre_empresa, nombre_contacto, email_admin, notas })
    .eq('client_id', client_id)

  if (error) return { ok: false, error: error.message }

  const { data: { user: u5 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  u5?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'editar',
    description: `Editó datos del cliente ${client_id} — Empresa: ${nombre_empresa}`,
  })

  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  return { ok: true as const }
}
