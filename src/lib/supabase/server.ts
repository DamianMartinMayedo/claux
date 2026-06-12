import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { isAuthBypassed } from '@/lib/dev-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function createClient() {
  // Bypass de login SOLO en dev: sin sesión real de Supabase Auth, las lecturas
  // del admin (que normalmente usan la clave anon + RLS) devolverían vacío. Con el
  // bypass activo usamos service_role para que el admin muestre datos al probar.
  if (isAuthBypassed()) return createAdminClient()

  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
