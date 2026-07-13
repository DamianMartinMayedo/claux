'use server'

import { requirePermiso } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { renderPlantilla } from '@/lib/email/render'
import { enviarEmail } from '@/lib/email/enviar'
import { PLANTILLAS_VARS, TIPOS_EMAIL, type TipoEmail } from '@/lib/email/variables'

export interface PlantillaEmailAdmin {
  tipo:       TipoEmail
  asunto:     string
  cuerpo:     string
  activo:     boolean
  updated_at: string
}

export async function listarPlantillas(): Promise<PlantillaEmailAdmin[]> {
  await requirePermiso('notificaciones')
  const db = createAdminClient()
  const { data } = await db
    .from('email_plantillas')
    .select('tipo, asunto, cuerpo, activo, updated_at')
  const porTipo = new Map((data ?? []).map(p => [p.tipo, p as PlantillaEmailAdmin]))
  // Orden fijo (el de TIPOS_EMAIL), no el de la BD.
  return TIPOS_EMAIL
    .map(t => porTipo.get(t.tipo))
    .filter((p): p is PlantillaEmailAdmin => !!p)
}

export async function guardarPlantilla(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('notificaciones')

  const tipo   = ((formData.get('tipo')   as string) ?? '').trim() as TipoEmail
  const asunto = ((formData.get('asunto') as string) ?? '').trim()
  const cuerpo = ((formData.get('cuerpo') as string) ?? '').trim()
  const activo = formData.get('activo') === 'true'

  if (!TIPOS_EMAIL.some(t => t.tipo === tipo)) return { ok: false, error: 'Tipo de plantilla inválido.' }
  if (!asunto) return { ok: false, error: 'El asunto es obligatorio.' }
  if (!cuerpo) return { ok: false, error: 'El cuerpo es obligatorio.' }

  const db = createAdminClient()
  const { error } = await db
    .from('email_plantillas')
    .update({ asunto, cuerpo, activo, updated_at: new Date().toISOString() })
    .eq('tipo', tipo)
  if (error) return { ok: false, error: 'No se pudo guardar la plantilla.' }

  revalidatePath('/admin/notificaciones')
  return { ok: true }
}

// Envía la plantilla al propio correo del admin en sesión, con los valores de
// ejemplo de PLANTILLAS_VARS — así ve exactamente lo que recibirá el cliente.
export async function enviarPruebaPlantilla(tipo: TipoEmail): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermiso('notificaciones')
  if (!TIPOS_EMAIL.some(t => t.tipo === tipo)) return { ok: false, error: 'Tipo de plantilla inválido.' }

  const vars = Object.fromEntries(PLANTILLAS_VARS[tipo].map(v => [v.clave, v.ejemplo]))
  const { asunto, html } = await renderPlantilla(tipo, vars)

  const res = await enviarEmail({
    to: ctx.email,
    subject: `[PRUEBA] ${asunto}`,
    html,
    tipo,
  })
  if (!res.ok) return { ok: false, error: 'No se pudo enviar la prueba. Revisa la configuración de Resend.' }
  return { ok: true }
}
