// ── Resolución del contexto de admin (server-only) ──
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuthBypassed, DEV_ADMIN } from '@/lib/dev-auth'
import type { ContextoAdmin, SeccionKey } from '@/lib/roles'

/** Emails super-admin de bootstrap (ADMIN_EMAILS). Vacío si no está configurada. */
function superAdminsBootstrap(): string[] {
  const raw = process.env.ADMIN_EMAILS?.trim()
  if (!raw) return []
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

/**
 * Resuelve el contexto del admin en sesión (rol + permisos) o `null` si la
 * cuenta no está autorizada. Lee la sesión de Supabase Auth y, para vendedores,
 * la fila `admin_users` (service_role).
 *
 * Bootstrap: cualquier email en ADMIN_EMAILS es super_admin aunque no tenga
 * fila. Si ADMIN_EMAILS no está configurada, se mantiene el fail-open histórico.
 */
export async function obtenerContextoAdmin(): Promise<ContextoAdmin | null> {
  // Bypass de desarrollo → super_admin ficticio (sin tocar BD).
  if (isAuthBypassed()) {
    return { email: DEV_ADMIN.email, nombre: DEV_ADMIN.user_metadata.full_name, rol: 'super_admin', permisos: [] }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null

  const email  = user.email.trim().toLowerCase()
  const nombre = (user.user_metadata?.full_name as string | undefined) || email.split('@')[0]

  const whitelist = superAdminsBootstrap()

  // Sin whitelist configurada → fail-open (comportamiento histórico): super_admin.
  if (whitelist.length === 0)      return { email, nombre, rol: 'super_admin', permisos: [] }
  // En whitelist → super_admin.
  if (whitelist.includes(email))   return { email, nombre, rol: 'super_admin', permisos: [] }

  // Vendedor / super_admin gestionado: fila activa en admin_users.
  const db = createAdminClient()
  const { data } = await db
    .from('admin_users')
    .select('nombre, rol, permisos, activo')
    .eq('email', email)
    .maybeSingle()

  if (!data || !data.activo) return null

  if (data.rol === 'super_admin') {
    return { email, nombre: data.nombre || nombre, rol: 'super_admin', permisos: [] }
  }
  return {
    email,
    nombre:   data.nombre || nombre,
    rol:      'vendedor',
    permisos: (data.permisos ?? []) as SeccionKey[],
  }
}
