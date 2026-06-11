'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'

export async function getSetting(key: string, fallback: string): Promise<string> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  return data?.value ?? fallback
}

export async function guardarSetting(key: string, value: string) {
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
