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

/**
 * Los tres buzones de CLAUX, con su valor por defecto en UN solo sitio.
 *
 * Ninguna de las tres claves tenía fila en `settings`, así que el correo real
 * vivía tecleado en las seis llamadas que lo leían: cambiarlo desde
 * /admin/notificaciones creaba la fila y funcionaba, pero mientras nadie lo
 * tocara, el destino de un aviso dependía de qué archivo lo mandaba. Aquí está
 * el default; el valor vigente sigue siendo el de la fila cuando existe.
 *
 *   · `email_avisos_internos` — el buzón del equipo: leads, altas, incidencias.
 *   · `email_contratacion`    — a dónde llega quien quiere contratar o ampliar.
 *   · `email_soporte`         — el que se le ENSEÑA al cliente en su portal.
 */
export const CORREO_POR_DEFECTO = {
  email_avisos_internos: 'contacto@claux.es',
  email_contratacion:    'contacto@claux.es',
  email_soporte:         'soporte@claux.es',
} as const

export type ClaveCorreo = keyof typeof CORREO_POR_DEFECTO

/** Lee uno de los tres buzones sin que quien llama tenga que saberse el default. */
export function leerCorreo(clave: ClaveCorreo): Promise<string> {
  return leerSetting(clave, CORREO_POR_DEFECTO[clave])
}
