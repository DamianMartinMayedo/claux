import { createClient } from '@supabase/supabase-js'

function nuevoClienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  if (!key || key.startsWith('REEMPLAZAR')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurado en .env.local')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

// El tipo sale de la llamada real, no de `ReturnType<typeof createClient>`:
// sobre la función genérica, TypeScript instancia los parámetros por su
// restricción y no por su valor por defecto, y el esquema entero degenera a
// `never` (todas las consultas del repo dejan de tipar).
let cliente: ReturnType<typeof nuevoClienteAdmin> | null = null

/**
 * Cliente Supabase con service_role key.
 * Solo usar en Server Actions / Route Handlers — nunca en cliente.
 * Bypassa RLS — validar siempre a nivel de aplicación.
 *
 * Instancia única y perezosa: hay ~500 llamadas en el repo y cada una construía
 * un SupabaseClient entero (Postgrest + Auth + Realtime + Storage) solo para
 * tirar una consulta. Reutilizarla es seguro porque no guarda estado de usuario:
 * es service_role, sin sesión (`persistSession: false`) y en el repo nunca se le
 * llama a `.auth` ni a realtime — eso va siempre por el cliente SSR de
 * `supabase/server.ts`. Lo que NO se puede es crearla al cargar el módulo: la
 * clave es variable «sensitive» de Vercel y no existe en el entorno de build.
 */
export function createAdminClient() {
  cliente ??= nuevoClienteAdmin()
  return cliente
}
