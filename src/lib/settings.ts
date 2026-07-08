import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Lectura interna de un ajuste global de `settings`, SIN guard de admin y con el
 * cliente de servicio (bypassa RLS, funciona sin sesión de Supabase Auth).
 *
 * Es una función de servidor normal, NO un server action: no se expone como
 * endpoint, así que no filtra la configuración a clientes arbitrarios. La usan
 * las superficies no-admin (portal: dashboard, perfil, facturación) que solo
 * necesitan leer un valor global — p. ej. `descuento_anual_pct` para calcular el
 * precio de la suscripción. Los usuarios de portal se autentican con
 * `client_users` + JWT, no con Supabase Auth, por eso NO pueden pasar por
 * `requireAdmin()` (ver `getSetting`).
 */
export async function leerSetting(key: string, fallback: string): Promise<string> {
  const db = createAdminClient()
  const { data } = await db
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  return data?.value ?? fallback
}
