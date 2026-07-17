'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { devPortalSession } from '@/lib/dev-auth'
import { modulosDeUsuario, calcularAcceso, type AccesoModulos } from '@/lib/permisos'
import {
  signPortalToken,
  verifyPortalToken,
  hashPasswordPortal,
  PORTAL_COOKIE,
  PORTAL_COOKIE_OPTS,
  type PortalSession,
} from '@/lib/portal-auth'

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
  jar.set(PORTAL_COOKIE, token, PORTAL_COOKIE_OPTS)

  // Último acceso real del usuario (métricas de uso). No bloquea el login.
  after(async () => {
    await createAdminClient()
      .from('client_users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('user_id', usuario.user_id)
      .eq('client_id', usuario.client_id)
  })

  if (usuario.must_change_password) return { mustChangePassword: true }
  return {}
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logoutCliente(): Promise<void> {
  const jar = await cookies()
  // La cookie vive en path '/portal' (PORTAL_COOKIE_OPTS): hay que borrarla con el
  // MISMO path o el navegador no la elimina (delete por defecto usa '/'), y la
  // sesión sobreviviría al "cerrar sesión".
  jar.set(PORTAL_COOKIE, '', { ...PORTAL_COOKIE_OPTS, maxAge: 0 })
  redirect('/portal/login')
}

// ── Cambio de contraseña obligatorio (primer acceso / tras reset) ──────────────
// El usuario ya está autenticado (la sesión lo prueba), así que no pedimos la
// contraseña actual: solo la nueva + confirmación. Al terminar, must_change_password
// pasa a false y deja de forzarse.
export async function cambiarPasswordObligatorio(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida. Vuelve a iniciar sesión.' }

  const nueva   = ((formData.get('password_nueva')   as string) ?? '').trim()
  const confirm = ((formData.get('password_confirm') as string) ?? '').trim()

  if (nueva.length < 8)   return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }
  if (nueva !== confirm)  return { ok: false, error: 'Las contraseñas no coinciden.' }

  const db   = createAdminClient()
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const hash = await hashPasswordPortal(nueva, salt)

  const { error } = await db
    .from('client_users')
    .update({ password_hash: hash, salt, must_change_password: false })
    .eq('user_id', session.user_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: 'No se pudo actualizar la contraseña.' }
  return { ok: true }
}

// Lee si el usuario de la sesión debe cambiar la contraseña (primer acceso/reset).
export async function debeCambiarPassword(session: PortalSession): Promise<boolean> {
  const db = createAdminClient()
  const { data } = await db
    .from('client_users')
    .select('must_change_password')
    .eq('user_id', session.user_id)
    .maybeSingle()
  return !!data?.must_change_password
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

// ── Acceso efectivo a módulos (tenant ∩ permisos por usuario) ────────
// Combina los módulos contratados por el tenant con los permisos por usuario
// (tabla usuario_modulo). Ver semántica en @/lib/permisos. Exportada para que
// un data-loader que ya tiene la sesión (p. ej. la ficha del tercero) gatee sus
// pestañas con el MISMO conjunto `visibles` que el sidebar, sin re-derivarla.
export async function accesoModulosSession(session: PortalSession): Promise<AccesoModulos> {
  const db = createAdminClient()
  const [{ data: cliente }, filas] = await Promise.all([
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).single(),
    modulosDeUsuario(db, session.user_id),
  ])
  const activos: string[] = Array.isArray(cliente?.modulos_activos)
    ? (cliente.modulos_activos as string[])
    : []
  return calcularAcceso(session, activos, filas)
}

/** Acceso efectivo del usuario actual (para el layout/sidebar). */
export async function getAccesoModulos(): Promise<AccesoModulos> {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')
  return accesoModulosSession(session)
}

// ── Medición de uso (métricas del admin) ───────────────────────────
// Registra un "hit" por módulo al cargar una página gateada. Fire-and-forget
// (no bloquea la respuesta). Se SALTA en sesiones de impersonación: la
// configuración del equipo CLAUX no debe contar como uso del cliente.
function registrarUso(session: PortalSession, modulo: string): void {
  if (session.imp) return
  after(async () => {
    await createAdminClient().rpc('uso_portal_hit', {
      p_client_id: session.client_id,
      p_user_id:   session.user_id,
      p_modulo:    modulo,
    })
  })
}

// ── Requerir módulo activo ──────────────────────────────────────────
// Para páginas de módulos/funcionalidades: si el usuario no lo puede VER
// (el tenant no lo contrató o el usuario no tiene permiso), redirige a dashboard.
export async function requireModulo(modulo: string): Promise<PortalSession> {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const acceso = await accesoModulosSession(session)
  if (!acceso.visibles.includes(modulo)) redirect('/portal/dashboard')

  registrarUso(session, modulo)
  return session
}

// Para páginas COMPARTIDAS por varios módulos (p. ej. Clientes y proveedores, que
// necesitan tanto Contabilidad como Inventario): basta con que el usuario vea UNO.
// El uso se registra contra el primero presente. Redirige a dashboard si ninguno.
export async function requireAlgunModulo(modulos: string[]): Promise<PortalSession> {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const acceso = await accesoModulosSession(session)
  const presente = modulos.find(m => acceso.visibles.includes(m))
  if (!presente) redirect('/portal/dashboard')

  registrarUso(session, presente)
  return session
}

// Variante que además devuelve si el usuario puede EDITAR el módulo, para que la
// página pase `puedeEditar` a su vista y deshabilite acciones cuando sea "solo ver".
export async function requireAccesoModulo(
  modulo: string,
): Promise<{ session: PortalSession; puedeEditar: boolean }> {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const acceso = await accesoModulosSession(session)
  if (!acceso.visibles.includes(modulo)) redirect('/portal/dashboard')

  registrarUso(session, modulo)
  return { session, puedeEditar: acceso.editable.has(modulo) }
}

// Chequeo de escritura para server actions de mutación de un módulo.
// Úsalo igual que hoy se chequea `session.solo_lectura` antes de escribir.
export async function puedeEditarModulo(modulo: string): Promise<boolean> {
  const session = await getPortalSession()
  if (!session) return false
  const acceso = await accesoModulosSession(session)
  return acceso.editable.has(modulo)
}
