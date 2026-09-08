'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'

// Las DOS decisiones del bloque de puesta en marcha que no se pueden deducir de
// los datos del negocio: «no me lo enseñes más» y «empiezo de cero». Todo lo
// demás (qué pasos faltan, cuáles están hechos) se cuenta en vivo — ver
// `lib/onboarding/pasos.ts`.
//
// GATING: el candado es de ROL, no de módulo (`rol !== 'admin_empresa'`, que
// `audit:gating` reconoce como candado válido). A propósito: estas tres no son de
// ningún módulo — escriben dos preferencias del propio cliente sobre una guía que
// no bloquea nada. Exigir un módulo contratado para poder cerrar un aviso sería
// pedirle al cliente justo lo que todavía no ha configurado. El resto del candado
// es el de siempre: la sesión acota `client_id` y solo-lectura no escribe.

const SIN_PERMISO = 'Solo el administrador de la cuenta puede hacer esto.'

/**
 * Oculta el bloque para SIEMPRE (se recupera desde Perfil). Va en `clients` y no
 * en el navegador: el dueño entra desde varios móviles y no tiene que volver a
 * cerrarlo en cada uno.
 *
 * Ocultarlo NO exime de lo obligatorio: si le falta moneda o empresa, el
 * dashboard vuelve a pintar el aviso de prerrequisito de siempre. Sin eso, un
 * clic aquí dejaría al cliente con un panel mudo y una app que no le deja hacer
 * nada, sin nada en pantalla que lo explique.
 */
export async function ocultarOnboarding(): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa' || session.solo_lectura) {
    return { ok: false, error: SIN_PERMISO }
  }
  const db = createAdminClient()
  const { error } = await db.from('clients')
    .update({ onboarding_oculto_at: new Date().toISOString() })
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/dashboard')
  return { ok: true }
}

/** Vuelve a enseñarlo. La entrada está en Perfil, que es donde se busca. */
export async function mostrarOnboarding(): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa' || session.solo_lectura) {
    return { ok: false, error: SIN_PERMISO }
  }
  const db = createAdminClient()
  const { error } = await db.from('clients')
    .update({ onboarding_oculto_at: null })
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/dashboard')
  revalidatePath('/portal/perfil')
  return { ok: true }
}

/**
 * «Empiezo de cero»: retira la pregunta de si trae datos de un sistema anterior.
 * NO toca `migracion_estado` —ese estado lo gobierna el equipo, y un cliente que
 * empieza de cero no cierra una migración—: solo deja de preguntárselo.
 */
export async function descartarImport(): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa' || session.solo_lectura) {
    return { ok: false, error: SIN_PERMISO }
  }
  const db = createAdminClient()
  const { error } = await db.from('clients')
    .update({ onboarding_import_no: true })
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/dashboard')
  return { ok: true }
}
