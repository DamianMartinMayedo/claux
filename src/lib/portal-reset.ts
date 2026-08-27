/**
 * Recuperar contraseña del portal — piezas compartidas por la página del enlace
 * (Server Component) y la acción que guarda la contraseña nueva.
 *
 * No es un fichero `'use server'` a propósito: aquí no hay endpoints, solo
 * lectura de servidor. La acción vive en `@/app/actions/portal/password-reset`.
 */
import { createAdminClient } from '@/lib/supabase/admin'

/** Cuánto vive un enlace. Corto, pero suficiente para leer el correo con calma. */
export const MINUTOS_VALIDEZ = 60

/**
 * En la tabla se guarda el hash, nunca el token (ver mig. 217). SHA-256 basta:
 * el token ya son 32 bytes aleatorios, así que no hay nada que adivinar por
 * fuerza bruta como pasaría con una contraseña elegida por una persona.
 */
export async function hashTokenReset(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export interface CuentaReset {
  user_id: string
  client_id: string
  empresa: string
}

export interface ResetValido {
  email:   string
  cuentas: CuentaReset[]
}

/**
 * Traduce un token de la URL a las cuentas a las que da derecho, o `null` si el
 * enlace no vale (no existe, ya se usó o caducó). Un enlace válido cuyo correo
 * ya no tenga ninguna cuenta activa también devuelve `null`: por fuera es el
 * mismo callejón sin salida y no hace falta contar cuál de los dos es.
 */
export async function cuentasDeTokenReset(token: string): Promise<ResetValido | null> {
  if (!token) return null
  const db = createAdminClient()

  const { data: fila } = await db
    .from('password_resets')
    .select('email, expira_at, usado_at')
    .eq('token_hash', await hashTokenReset(token))
    .maybeSingle()

  if (!fila || fila.usado_at) return null
  if (new Date(fila.expira_at).getTime() < Date.now()) return null

  const { data: usuarios } = await db
    .from('client_users')
    .select('user_id, client_id')
    .eq('email', fila.email)
    .eq('estado', 'ACTIVO')

  if (!usuarios?.length) return null

  // El nombre del negocio es solo para que la persona sepa cuál es cuál cuando
  // el mismo correo tiene cuenta en varios; si falta, el client_id sirve igual.
  const { data: clientes } = await db
    .from('clients')
    .select('client_id, nombre_empresa')
    .in('client_id', usuarios.map(u => u.client_id))

  const nombres = new Map((clientes ?? []).map(c => [c.client_id, c.nombre_empresa as string]))

  return {
    email: fila.email,
    cuentas: usuarios.map(u => ({
      user_id:   u.user_id,
      client_id: u.client_id,
      empresa:   nombres.get(u.client_id) ?? u.client_id,
    })),
  }
}
