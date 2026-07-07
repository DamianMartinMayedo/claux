/**
 * Bypass de autenticación SOLO para desarrollo local.
 *
 * DOBLE CANDADO obligatorio: para que el bypass se active deben cumplirse a la vez
 *   1. NODE_ENV === 'development'   (lo fija `next dev`; `next build`/`next start` lo ponen en 'production')
 *   2. DEV_BYPASS_AUTH === 'true'   (variable explícita en .env.local)
 *
 * En un build de producción la condición 1 es falsa, así que el bypass queda INERTE
 * aunque la variable esté en 'true'. NUNCA debe usarse fuera de local.
 *
 * Recuerda: en local la app se conecta a la Supabase COMPARTIDA en la nube; los datos
 * NO son locales. El bypass solo evita el login, no aísla los datos.
 */

import type { PortalSession } from '@/lib/portal-auth'

export function isAuthBypassed(): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.DEV_BYPASS_AUTH === 'true'
  )
}

/**
 * Lista blanca de administradores (defensa en profundidad). El panel /admin solo
 * comprobaba que existiera una sesión de Supabase Auth; con esto, además, el email
 * debe estar en ADMIN_EMAILS (coma-separada, en env — fuera del repo, que es
 * público). Así, aunque se cree una cuenta de Supabase Auth, si su email no está
 * autorizado NO entra al admin.
 *
 * Si ADMIN_EMAILS no está configurada, NO filtra (fail-open) para no bloquear
 * antes de ponerla: el registro público ya está desactivado, así que no pueden
 * aparecer cuentas nuevas por sorpresa. Configúrala en Vercel para activar el filtro.
 */
export function emailEsAdmin(email: string | null | undefined): boolean {
  const raw = process.env.ADMIN_EMAILS?.trim()
  if (!raw) return true
  const permitidos = raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  if (permitidos.length === 0) return true
  return !!email && permitidos.includes(email.trim().toLowerCase())
}

/** Usuario admin ficticio para pintar el shell del admin cuando el bypass está activo. */
export const DEV_ADMIN = {
  email: 'dev@local',
  user_metadata: { full_name: 'Dev (bypass)' },
} as const

/**
 * Sesión de portal ficticia para el bypass. Como los datos del portal son reales
 * (Supabase compartida), hay que IMPERSONAR un tenant existente: se elige por env.
 * Si DEV_PORTAL_CLIENT_ID no está definido, devolvemos null → el portal exige login
 * normal (solo se capa el admin).
 */
export function devPortalSession(): PortalSession | null {
  if (!isAuthBypassed()) return null

  const client_id = process.env.DEV_PORTAL_CLIENT_ID
  if (!client_id) return null

  const now = Math.floor(Date.now() / 1000)
  const rol = (process.env.DEV_PORTAL_ROL as PortalSession['rol']) || 'admin_empresa'

  return {
    user_id:      process.env.DEV_PORTAL_USER_ID || `${client_id}-U001`,
    client_id,
    email:        process.env.DEV_PORTAL_EMAIL || 'dev@local',
    rol,
    solo_lectura: false,
    iat:          now,
    exp:          now + 60 * 60 * 24,
  }
}
