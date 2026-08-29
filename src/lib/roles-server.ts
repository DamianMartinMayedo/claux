// ── Resolución del contexto de admin (server-only) ──
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuthBypassed, DEV_ADMIN } from '@/lib/dev-auth'
import type { ContextoAdmin, RolAdmin, SeccionKey } from '@/lib/roles'

/** Emails super-admin de bootstrap (ADMIN_EMAILS). Vacío si no está configurada. */
function superAdminsBootstrap(): string[] {
  const raw = process.env.ADMIN_EMAILS?.trim()
  if (!raw) return []
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

/**
 * Resuelve el contexto de la cuenta en sesión (rol + permisos) o `null` si no
 * está autorizada. Lee la sesión de Supabase Auth y, para todo lo que no sea un
 * super admin de bootstrap, la fila `admin_users` (service_role).
 *
 * Sirve a las dos clases de cuenta: `super_admin`, que lo ve todo, y `vendedor`,
 * que entra a las secciones que tenga marcadas (ver `puedeAcceder` en
 * `@/lib/roles`). Un revendedor de fuera es un vendedor más.
 *
 * Bootstrap: cualquier email en ADMIN_EMAILS es super_admin aunque no tenga
 * fila. Si ADMIN_EMAILS no está configurada, el fail-open histórico se mantiene
 * SOLO para cuentas sin fila.
 *
 * Memorizado por petición (`cache` de React): el layout, la página y las acciones
 * lo piden por separado, y sin esto cada una repetiría la llamada a Supabase Auth
 * y la consulta a `admin_users` para responder lo mismo.
 */
export const obtenerContextoAdmin = cache(async function obtenerContextoAdmin(): Promise<ContextoAdmin | null> {
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

  // En whitelist → super_admin, tenga fila o no (bootstrap: nunca deja al equipo fuera).
  if (whitelist.includes(email)) return { email, nombre, rol: 'super_admin', permisos: [] }

  // La fila manda sobre el fail-open. El orden importa: mientras el fail-open se
  // consultaba ANTES de leer la tabla, un entorno sin ADMIN_EMAILS convertía en
  // super_admin a cualquier cuenta autenticada — incluida la de un revendedor de
  // fuera. Con la fila leída primero, un vendedor es vendedor aunque la variable
  // de entorno falte.
  const db = createAdminClient()
  const { data } = await db
    .from('admin_users')
    .select('nombre, rol, permisos, activo')
    .eq('email', email)
    .maybeSingle()

  if (data) {
    if (!data.activo) return null
    const rol = data.rol as RolAdmin
    if (rol === 'super_admin') {
      return { email, nombre: data.nombre || nombre, rol: 'super_admin', permisos: [] }
    }
    // Un rol desconocido (fila vieja, dato tocado a mano) cae a vendedor, que es
    // el que menos ve: lo que abre cada sección son sus `permisos`, y una fila
    // sin permisos no abre ninguna.
    return {
      email,
      nombre:   data.nombre || nombre,
      rol:      'vendedor',
      permisos: (data.permisos ?? []) as SeccionKey[],
    }
  }

  // Sin fila y sin whitelist configurada → fail-open (comportamiento histórico).
  if (whitelist.length === 0) return { email, nombre, rol: 'super_admin', permisos: [] }
  return null
})
