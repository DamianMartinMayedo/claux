'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { logActividad } from '@/lib/audit'
import { PERMISOS_VENDEDOR_DEFAULT, SECCIONES, type RolAdmin, type SeccionKey } from '@/lib/roles'
import { revalidatePath } from 'next/cache'

export interface UsuarioAdmin {
  email:       string
  nombre:      string
  rol:         RolAdmin
  permisos:    SeccionKey[]
  activo:      boolean
  created_at:  string
  esBootstrap: boolean   // super_admin fijado por ADMIN_EMAILS (env), no por la tabla
  gestionable: boolean   // tiene fila en admin_users editable/eliminable desde el panel
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CLAVES_VALIDAS = new Set(SECCIONES.map(s => s.key))

type Resp = { ok: true } | { ok: false; error: string }

/** Emails super-admin de bootstrap (ADMIN_EMAILS). Vacío si no está configurada. */
function superAdminsBootstrap(): string[] {
  const raw = process.env.ADMIN_EMAILS?.trim()
  if (!raw) return []
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

function normalizarPermisos(rol: RolAdmin, permisos: string[]): SeccionKey[] {
  if (rol === 'super_admin') return []
  const limpio = (permisos ?? []).filter((k): k is SeccionKey => CLAVES_VALIDAS.has(k as SeccionKey))
  // Un vendedor sin ninguna sección no tendría a dónde entrar → mínimos por defecto.
  return limpio.length > 0 ? Array.from(new Set(limpio)) : [...PERMISOS_VENDEDOR_DEFAULT]
}

/**
 * Lista de usuarios internos (equipo). Solo super_admin.
 * Fusiona la tabla `admin_users` con las cuentas de Supabase Auth: así los
 * super admins de bootstrap (ADMIN_EMAILS) también aparecen, aunque no tengan
 * fila, marcados como "Cuenta base" (no editables/eliminables desde el panel;
 * su rol lo fija la env var, pero sí se les puede regenerar la contraseña).
 */
export async function listarUsuariosAdmin(): Promise<UsuarioAdmin[]> {
  await requireSuperAdmin()
  const db = createAdminClient()

  const [filasRes, authRes] = await Promise.all([
    db.from('admin_users').select('email, nombre, rol, permisos, activo, created_at'),
    db.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ])

  const authByEmail = new Map<string, { nombre?: string; created_at: string }>()
  for (const u of authRes.data?.users ?? []) {
    if (u.email) {
      authByEmail.set(u.email.toLowerCase(), {
        nombre: u.user_metadata?.full_name as string | undefined,
        created_at: u.created_at,
      })
    }
  }

  const whitelist = superAdminsBootstrap()
  const conFila = new Set<string>()
  const out: UsuarioAdmin[] = []

  // 1. Filas de admin_users (super admins env → rol forzado a super_admin).
  for (const f of filasRes.data ?? []) {
    const email = f.email.toLowerCase()
    conFila.add(email)
    const boot = whitelist.includes(email)
    out.push({
      email,
      nombre:      f.nombre,
      rol:         boot ? 'super_admin' : (f.rol as RolAdmin),
      permisos:    boot ? [] : ((f.permisos ?? []) as SeccionKey[]),
      activo:      boot ? true : f.activo,
      created_at:  f.created_at,
      esBootstrap: boot,
      gestionable: !boot,
    })
  }

  // 2. Super admins de bootstrap sin fila (cuentas base creadas en Supabase).
  for (const email of whitelist) {
    if (conFila.has(email)) continue
    const a = authByEmail.get(email)
    out.push({
      email,
      nombre:      a?.nombre || email.split('@')[0],
      rol:         'super_admin',
      permisos:    [],
      activo:      true,
      created_at:  a?.created_at || new Date(0).toISOString(),
      esBootstrap: true,
      gestionable: false,
    })
  }

  // Cuentas base primero, luego por nombre.
  return out.sort((a, b) =>
    a.esBootstrap === b.esBootstrap ? a.nombre.localeCompare(b.nombre) : a.esBootstrap ? -1 : 1,
  )
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
  // La cuenta puede tener fila en admin_users (vendedor / super admin gestionado)
  // o ser una "cuenta base" de bootstrap sin fila → resolvemos por Supabase Auth.
  let authUserId: string | null = null
  const { data: fila } = await db.from('admin_users').select('auth_user_id').eq('email', clave).maybeSingle()
  authUserId = fila?.auth_user_id ?? null
  if (!authUserId) {
    const { data: usuarios } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
    authUserId = usuarios?.users?.find(u => u.email?.toLowerCase() === clave)?.id ?? null
  }
  if (!authUserId) return { ok: false, error: 'Usuario sin cuenta de acceso asociada.' }

  const { error } = await db.auth.admin.updateUserById(authUserId, { password: nuevaPassword })
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
