import { createClient } from '@/lib/supabase/server'
import { isAuthBypassed, emailEsAdmin } from '@/lib/dev-auth'

/**
 * Guard de las acciones de servidor del admin (defensa en profundidad). Lanza si
 * no hay una sesión de Supabase Auth autorizada (email en ADMIN_EMAILS). Así, una
 * cuenta de Supabase que no sea admin no puede invocar acciones del admin aunque
 * conozca el endpoint. En desarrollo, el bypass local lo salta.
 */
export async function requireAdmin(): Promise<void> {
  if (isAuthBypassed()) return
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !emailEsAdmin(user.email)) {
    throw new Error('Acceso no autorizado.')
  }
}
