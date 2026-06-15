'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { devPortalSession } from '@/lib/dev-auth'
import {
  signPortalToken,
  verifyPortalToken,
  hashPasswordPortal,
  PORTAL_COOKIE,
  SESSION_DURATION,
  type PortalSession,
} from '@/lib/portal-auth'

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path:     '/portal',
  maxAge:   SESSION_DURATION,
}

// ── Login ─────────────────────────────────────────────────────────────────────

export async function loginCliente(
  formData: FormData,
): Promise<{ error?: string; mustChangePassword?: boolean }> {
  const email    = ((formData.get('email')    as string) ?? '').trim().toLowerCase()
  const password = ((formData.get('password') as string) ?? '')

  if (!email || !password) return { error: 'Email y contraseña son obligatorios.' }

  const db = createAdminClient()

  const { data: usuario } = await db
    .from('client_users')
    .select('user_id, client_id, email, password_hash, salt, rol, solo_lectura, estado, must_change_password')
    .eq('email', email)
    .maybeSingle()

  if (!usuario) return { error: 'Credenciales incorrectas.' }

  if (usuario.estado !== 'ACTIVO') {
    return { error: 'Tu usuario está inactivo. Contacta con el administrador.' }
  }

  const hash = await hashPasswordPortal(password, usuario.salt)
  if (hash !== usuario.password_hash) return { error: 'Credenciales incorrectas.' }

  const token = await signPortalToken({
    user_id:      usuario.user_id,
    client_id:    usuario.client_id,
    email:        usuario.email,
    rol:          usuario.rol,
    solo_lectura: usuario.solo_lectura ?? false,
  })

  const jar = await cookies()
  jar.set(PORTAL_COOKIE, token, COOKIE_OPTS)

  if (usuario.must_change_password) return { mustChangePassword: true }
  return {}
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logoutCliente(): Promise<void> {
  const jar = await cookies()
  jar.delete(PORTAL_COOKIE)
  redirect('/portal/login')
}

// ── Leer sesión (Server Components / Actions) ─────────────────────────────────

export async function getPortalSession(): Promise<PortalSession | null> {
  const jar   = await cookies()
  const token = jar.get(PORTAL_COOKIE)?.value
  // Bypass de login SOLO en desarrollo local: si no hay cookie y el bypass está activo
  // (doble candado), impersonamos el tenant indicado en DEV_PORTAL_CLIENT_ID.
  if (!token) return devPortalSession()
  return verifyPortalToken(token)
}

// ── Requerir módulo activo ──────────────────────────────────────────
// Para páginas de funcionalidades: si el cliente no tiene el módulo contratado,
// redirige a /portal/dashboard.
export async function requireModulo(modulo: string): Promise<PortalSession> {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const db = createAdminClient()
  const { data: cliente } = await db
    .from('clients')
    .select('modulos_activos')
    .eq('client_id', session.client_id)
    .single()

  const activos: string[] = Array.isArray(cliente?.modulos_activos) ? cliente.modulos_activos : []
  if (!activos.includes(modulo)) redirect('/portal/dashboard')

  return session
}
