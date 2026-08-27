'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { hashPasswordPortal } from '@/lib/portal-auth'
import { cuentasDeTokenReset, hashTokenReset, MINUTOS_VALIDEZ } from '@/lib/portal-reset'
import { renderPlantilla } from '@/lib/email/render'
import { enviarEmail, tipoEmailActivo } from '@/lib/email/enviar'

// ── Recuperar la contraseña sin depender del equipo CLAUX ─────────────────────
// El camino completo: «¿Olvidaste tu contraseña?» en /portal/login → correo con
// un enlace de un solo uso → /portal/recuperar/<token> → contraseña nueva.
// Nadie tiene sesión en ninguno de los dos pasos, así que el candado no es de
// módulo (ver ALLOWLIST de scripts/audit-gating.mjs) sino el propio token:
// aleatorio, guardado en hash, de un solo uso y con caducidad (mig. 217).

/** Peticiones que se aceptan por correo dentro de la ventana, antes de ignorar. */
const MAX_POR_VENTANA = 3
const VENTANA_MINUTOS = 15

/**
 * Pide el enlace. SIEMPRE responde lo mismo —haya cuenta o no—: si el mensaje
 * cambiara según el correo existiera, esta pantalla sería un buscador gratis de
 * clientes de CLAUX. Quien tenga cuenta recibe el correo; quien no, nada.
 */
export async function solicitarResetPortal(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const email = ((formData.get('email') as string) ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) return { ok: false, error: 'Escribe un email válido.' }

  const db  = createAdminClient()
  const now = Date.now()

  // Limpieza oportunista: un enlace de hace días no le sirve a nadie y la tabla
  // no merece un cron para ella sola.
  await db.from('password_resets')
    .delete()
    .lt('expira_at', new Date(now - 24 * 60 * 60 * 1000).toISOString())

  // Control de frecuencia por correo: evita que alguien use el formulario para
  // inundar el buzón de un cliente. Se calla y devuelve ok, como en el resto de
  // casos, para no delatar nada.
  const { count } = await db
    .from('password_resets')
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gte('created_at', new Date(now - VENTANA_MINUTOS * 60 * 1000).toISOString())
  if ((count ?? 0) >= MAX_POR_VENTANA) return { ok: true }

  const { data: usuarios } = await db
    .from('client_users')
    .select('user_id')
    .eq('email', email)
    .eq('estado', 'ACTIVO')
  if (!usuarios?.length) return { ok: true }

  // Un enlace vivo a la vez: pedir uno nuevo mata los anteriores. Si el usuario
  // pidió dos porque el primero tardaba, que el bueno sea el último que le llegó.
  await db.from('password_resets')
    .update({ usado_at: new Date().toISOString() })
    .eq('email', email)
    .is('usado_at', null)

  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('')

  const { error } = await db.from('password_resets').insert({
    email,
    token_hash: await hashTokenReset(token),
    expira_at:  new Date(now + MINUTOS_VALIDEZ * 60 * 1000).toISOString(),
  })
  if (error) return { ok: false, error: 'No se pudo generar el enlace. Inténtalo de nuevo.' }

  if (await tipoEmailActivo('password_reset_link')) {
    const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://claux.es').replace(/\/$/, '')
    const { asunto, html } = await renderPlantilla('password_reset_link', {
      usuario:    email,
      link_reset: `${base}/portal/recuperar/${token}`,
      minutos:    String(MINUTOS_VALIDEZ),
    })
    // `enviarEmail` no lanza: un fallo queda en emails_log y la pantalla sigue
    // diciendo lo mismo. Decir «no salió el correo» aquí volvería a delatar que
    // ese correo existe.
    await enviarEmail({ to: email, subject: asunto, html, tipo: 'password_reset_link' })
  }

  return { ok: true }
}

/**
 * Guarda la contraseña nueva. El token manda: identifica el correo, y el usuario
 * elegido tiene que ser una de las cuentas activas de ESE correo —si no, no se
 * toca nada—. Al terminar, el enlace queda consumido.
 */
export async function restablecerPasswordPortal(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const token   = ((formData.get('token')   as string) ?? '').trim()
  const userId  = ((formData.get('user_id') as string) ?? '').trim()
  const nueva   = ((formData.get('password_nueva')   as string) ?? '').trim()
  const confirm = ((formData.get('password_confirm') as string) ?? '').trim()

  if (nueva.length < 8)  return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }
  if (nueva !== confirm) return { ok: false, error: 'Las contraseñas no coinciden.' }

  const valido = await cuentasDeTokenReset(token)
  if (!valido) return { ok: false, error: 'El enlace ya no es válido. Pide uno nuevo desde el inicio de sesión.' }

  const cuenta = valido.cuentas.find(c => c.user_id === userId) ?? (valido.cuentas.length === 1 ? valido.cuentas[0] : null)
  if (!cuenta) return { ok: false, error: 'Elige la cuenta a la que le pones la contraseña nueva.' }

  const db   = createAdminClient()
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const hash = await hashPasswordPortal(nueva, salt)

  // `must_change_password: false`: la acaba de elegir él, no hay nada que
  // obligarle a cambiar en el primer acceso.
  const { error } = await db
    .from('client_users')
    .update({ password_hash: hash, salt, must_change_password: false })
    .eq('user_id', cuenta.user_id)
    .eq('client_id', cuenta.client_id)

  if (error) return { ok: false, error: 'No se pudo guardar la contraseña. Inténtalo de nuevo.' }

  // El enlace se quema DESPUÉS de guardar: si el update fallara, el usuario
  // todavía puede reintentar con el mismo correo en la mano.
  await db.from('password_resets')
    .update({ usado_at: new Date().toISOString() })
    .eq('token_hash', await hashTokenReset(token))

  return { ok: true }
}
