'use server'

import { requireAdmin, requireSuperAdmin } from '@/lib/admin-guard'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'
import { leerSetting } from '@/lib/settings'

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
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'sistema',
    action:      'configuracion',
    description: `Actualizó configuración: ${key} = ${value}`,
  })

  revalidatePath('/admin/notificaciones')
  revalidatePath('/admin/dashboard')
  return { ok: true as const }
}
