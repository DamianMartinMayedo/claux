'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'

export async function editarModulo(formData: FormData) {
  const supabase = await createClient()

  const clave                = (formData.get('clave')                as string ?? '').trim()
  const nombre               = (formData.get('nombre')               as string ?? '').trim()
  const descripcion          = (formData.get('descripcion')          as string ?? '').trim() || null
  const precio_fundador_usd  = parseFloat(formData.get('precio_fundador_usd')  as string ?? '0')
  const precio_estandar_usd  = parseFloat(formData.get('precio_estandar_usd')  as string ?? '0')
  const activo               = formData.get('activo') === 'true'

  if (!clave || !nombre) return { ok: false, error: 'Clave y nombre son obligatorios.' }
  if (isNaN(precio_fundador_usd) || isNaN(precio_estandar_usd)) return { ok: false, error: 'Precios inválidos.' }

  const { error } = await supabase
    .from('modulos_catalogo')
    .update({ nombre, descripcion, precio_fundador_usd, precio_estandar_usd, activo, updated_at: new Date().toISOString() })
    .eq('clave', clave)

  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'modulo_catalogo',
    entity_id:   clave,
    action:      'editar',
    description: `Editó módulo ${clave} — fundador: $${precio_fundador_usd} / estándar: $${precio_estandar_usd} — activo: ${activo}`,
  })

  revalidatePath('/admin/modulos')
  return { ok: true as const }
}
