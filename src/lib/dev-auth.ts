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
