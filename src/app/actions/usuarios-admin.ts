'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { logActividad } from '@/lib/audit'
import { PERMISOS_VENDEDOR_DEFAULT, SECCIONES, type RolAdmin, type SeccionKey } from '@/lib/roles'
import { revalidatePath } from 'next/cache'

export interface UsuarioAdmin {
  email:      string
  nombre:     string
  rol:        RolAdmin
  permisos:   SeccionKey[]
  activo:     boolean
  created_at: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CLAVES_VALIDAS = new Set(SECCIONES.map(s => s.key))

type Resp = { ok: true } | { ok: false; error: string }

function normalizarPermisos(rol: RolAdmin, permisos: string[]): SeccionKey[] {
  if (rol === 'super_admin') return []
  const limpio = (permisos ?? []).filter((k): k is SeccionKey => CLAVES_VALIDAS.has(k as SeccionKey))
  // Un vendedor sin ninguna sección no tendría a dónde entrar → mínimos por defecto.
  return limpio.length > 0 ? Array.from(new Set(limpio)) : [...PERMISOS_VENDEDOR_DEFAULT]
}

/** Lista de usuarios internos (equipo). Solo super_admin. */
export async function listarUsuariosAdmin(): Promise<UsuarioAdmin[]> {
  await requireSuperAdmin()
  const db = createAdminClient()
  const { data } = await db
    .from('admin_users')
    .select('email, nombre, rol, permisos, activo, created_at')
    .order('created_at', { ascending: false })
  return (data ?? []) as UsuarioAdmin[]
}

/** Crea un usuario interno + su cuenta de Supabase Auth (email + contraseña). */
export async function crearUsuarioAdmin(args: {
  email: string
  nombre: string
  rol: RolAdmin
  permisos: string[]
  password: string
}): Promise<Resp & { email?: string }> {
  const ctx = await requireSuperAdmin()

  const email  = (args.email || '').trim().toLowerCase()
  const nombre = (args.nombre || '').trim()
  const rol: RolAdmin = args.rol === 'super_admin' ? 'super_admin' : 'vendedor'
  const password = args.password || ''

  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Correo no válido.' }
  if (!nombre)               return { ok: false, error: 'El nombre es obligatorio.' }
  if (password.length < 8)   return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }

  const db = createAdminClient()

  // ¿ya existe la fila?
  const { data: existe } = await db.from('admin_users').select('email').eq('email', email).maybeSingle()
  if (existe) return { ok: false, error: 'Ya existe un usuario con ese correo.' }

  const permisos = normalizarPermisos(rol, args.permisos)

  // 1. Crear la cuenta de acceso (Supabase Auth) vía service_role.
  const { data: created, error: authError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: nombre },
  })
  if (authError || !created?.user) {
    return { ok: false, error: authError?.message || 'No se pudo crear la cuenta de acceso.' }
  }

  // 2. Registrar la fila de rol/permisos.
  const { error } = await db.from('admin_users').insert({
    email,
    nombre,
    rol,
    permisos,
    activo: true,
    auth_user_id: created.user.id,
  })
  if (error) {
    // Rollback de la cuenta si no pudo guardarse la fila.
    await db.auth.admin.deleteUser(created.user.id).catch(() => {})
    return { ok: false, error: error.message }
  }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'usuario',
    entity_id:   email,
    action:      'crear',
    description: `Creó usuario ${nombre} (${email}) — rol ${rol}`,
  })

  revalidatePath('/admin/usuarios')
  return { ok: true, email }
}

/** Actualiza nombre, rol, permisos y estado (activo) de un usuario interno. */
export async function actualizarUsuarioAdmin(email: string, args: {
  nombre: string
  rol: RolAdmin
  permisos: string[]
  activo: boolean
}): Promise<Resp> {
  const ctx = await requireSuperAdmin()

  const clave = (email || '').trim().toLowerCase()
  const nombre = (args.nombre || '').trim()
  const rol: RolAdmin = args.rol === 'super_admin' ? 'super_admin' : 'vendedor'
  if (!clave)   return { ok: false, error: 'Usuario no válido.' }
  if (!nombre)  return { ok: false, error: 'El nombre es obligatorio.' }

  // No permitir que un super_admin se auto-desactive/degrade (evita quedarse fuera).
  if (clave === ctx.email && (rol !== 'super_admin' || !args.activo)) {
    return { ok: false, error: 'No puedes cambiar tu propio rol ni desactivarte.' }
  }

  const db = createAdminClient()
  const permisos = normalizarPermisos(rol, args.permisos)

  const { error } = await db
    .from('admin_users')
    .update({ nombre, rol, permisos, activo: args.activo })
    .eq('email', clave)
  if (error) return { ok: false, error: error.message }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'usuario',
    entity_id:   clave,
    action:      'editar',
    description: `Editó usuario ${clave} — rol ${rol} · activo ${args.activo} · permisos [${permisos.join(', ')}]`,
  })

  revalidatePath('/admin/usuarios')
  return { ok: true }
}

/** Regenera la contraseña de acceso de un usuario interno. */
export async function resetPasswordUsuarioAdmin(email: string, nuevaPassword: string): Promise<Resp> {
  const ctx = await requireSuperAdmin()
  const clave = (email || '').trim().toLowerCase()
  if (nuevaPassword.length < 8) return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }

  const db = createAdminClient()
  const { data: fila } = await db.from('admin_users').select('auth_user_id').eq('email', clave).maybeSingle()
  if (!fila?.auth_user_id) return { ok: false, error: 'Usuario sin cuenta de acceso asociada.' }

  const { error } = await db.auth.admin.updateUserById(fila.auth_user_id, { password: nuevaPassword })
  if (error) return { ok: false, error: error.message }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'usuario',
    entity_id:   clave,
    action:      'reset_password',
    description: `Regeneró la contraseña del usuario ${clave}`,
  })
  return { ok: true }
}

/** Elimina un usuario interno (fila + cuenta de acceso). */
export async function eliminarUsuarioAdmin(email: string): Promise<Resp> {
  const ctx = await requireSuperAdmin()
  const clave = (email || '').trim().toLowerCase()
  if (clave === ctx.email) return { ok: false, error: 'No puedes eliminar tu propio usuario.' }

  const db = createAdminClient()
  const { data: fila } = await db.from('admin_users').select('auth_user_id').eq('email', clave).maybeSingle()

  const { error } = await db.from('admin_users').delete().eq('email', clave)
  if (error) return { ok: false, error: error.message }

  if (fila?.auth_user_id) {
    await db.auth.admin.deleteUser(fila.auth_user_id).catch(() => {})
  }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'usuario',
    entity_id:   clave,
    action:      'eliminar',
    description: `Eliminó al usuario ${clave}`,
  })

  revalidatePath('/admin/usuarios')
  return { ok: true }
}
