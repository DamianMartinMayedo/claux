import { redirect } from 'next/navigation'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import {
  puedeAcceder,
  primeraRutaPermitida,
  type ContextoAdmin,
  type SeccionKey,
} from '@/lib/roles'

/**
 * Guards de las acciones/páginas del admin (defensa en profundidad).
 * Toda la lógica de rol/permisos vive en `@/lib/roles`. En desarrollo, el
 * bypass local resuelve a super_admin.
 */

/** Contexto del admin en sesión; lanza si la cuenta no está autorizada. */
export async function requireContextoAdmin(): Promise<ContextoAdmin> {
  const ctx = await obtenerContextoAdmin()
  if (!ctx) throw new Error('Acceso no autorizado.')
  return ctx
}

/** Compat: exige sesión de admin autorizada (cualquier rol). */
export async function requireAdmin(): Promise<void> {
  await requireContextoAdmin()
}

/** Exige que el admin en sesión sea super_admin. */
export async function requireSuperAdmin(): Promise<ContextoAdmin> {
  const ctx = await requireContextoAdmin()
  if (ctx.rol !== 'super_admin') throw new Error('Acceso no autorizado.')
  return ctx
}

/** Guard de ACCIÓN por sección: lanza si el admin no puede acceder a `key`. */
export async function requirePermiso(key: SeccionKey): Promise<ContextoAdmin> {
  const ctx = await requireContextoAdmin()
  if (!puedeAcceder(ctx, key)) throw new Error('Acceso no autorizado.')
  return ctx
}

/** Guard de PÁGINA por sección: redirige en vez de lanzar si no procede. */
export async function requireAccesoPagina(key: SeccionKey): Promise<ContextoAdmin> {
  const ctx = await obtenerContextoAdmin()
  if (!ctx) redirect('/admin/login')
  if (!puedeAcceder(ctx, key)) redirect(primeraRutaPermitida(ctx))
  return ctx
}
