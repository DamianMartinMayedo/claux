'use server'

import { requireAdmin, requireSuperAdmin } from '@/lib/admin-guard'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'
import { leerSetting } from '@/lib/settings'
import { refrescarTodasLasPropuestas } from '@/lib/propuesta/refrescar'

/** Lectura de un ajuste desde el ADMIN (mantiene el guard como defensa en
 *  profundidad). El portal NO debe usar esta acción — usa `leerSetting` de
 *  `@/lib/settings`, que no exige sesión de Supabase Auth. */
export async function getSetting(key: string, fallback: string): Promise<string> {
  await requireAdmin()
  return leerSetting(key, fallback)
}

export async function guardarSetting(key: string, value: string) {
  await requireSuperAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return { ok: false as const, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  // El valor se recorta en el log: los textos de la propuesta son párrafos y un
  // JSON de tarjetas entero convierte la actividad en un volcado ilegible.
  const resumen = value.length > 120 ? `${value.slice(0, 120)}…` : value
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'sistema',
    action:      'configuracion',
    description: `Actualizó configuración: ${key} = ${resumen}`,
  })

  revalidatePath('/admin/notificaciones')
  revalidatePath('/admin/dashboard')
  // Las páginas legales son ISR (1 h) y su texto sale de aquí: sin esto, un
  // cambio tardaría hasta una hora en verse. Con 'layout' caen las tres rutas
  // de /legal/[slug] de una vez.
  if (key.startsWith('legal_')) revalidatePath('/legal', 'layout')
  // Los textos fijos de la propuesta salen en TODAS: la propuesta no los guarda,
  // los lee de aquí al renderizar. Sin esto, cambiar «cómo empezamos» tardaría
  // hasta una hora en verse en los enlaces que ya están en manos de un cliente.
  if (key.startsWith('propuesta_')) await refrescarTodasLasPropuestas(supabase)
  return { ok: true as const }
}
