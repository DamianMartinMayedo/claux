// ── Rate limiting de endpoints públicos ──
// Ventana fija por (acción, IP) sobre la función atómica rl_hit (mig. 057).
// Fail-open: si el limitador falla, NO bloqueamos (no romper reservas legítimas).

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

export async function clientIp(): Promise<string> {
  const h = await headers()
  const fwd = h.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return h.get('x-real-ip') || 'unknown'
}

/**
 * Devuelve true si la petición está permitida, false si excede el límite.
 * @param accion etiqueta de la acción (p. ej. 'reserva_crear')
 * @param max    nº máximo de peticiones por ventana
 * @param windowSeconds tamaño de la ventana en segundos
 * @param extra clave adicional opcional (p. ej. slug del negocio)
 */
export async function rateLimitOk(accion: string, max: number, windowSeconds: number, extra?: string): Promise<boolean> {
  const ip = await clientIp()
  const bucket = `${accion}:${ip}${extra ? `:${extra}` : ''}`
  const db = createAdminClient()
  const { data, error } = await db.rpc('rl_hit', { p_key: bucket, p_max: max, p_window: windowSeconds })
  if (error) return true // fail-open
  return data === true
}
