import { createClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase con service_role key.
 * Solo usar en Server Actions / Route Handlers — nunca en cliente.
 * Bypassa RLS — validar siempre a nivel de aplicación.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  if (!key || key.startsWith('REEMPLAZAR')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurado en .env.local')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}
