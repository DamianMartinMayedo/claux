// ── Configuración del bot de Telegram (compartida por Reservas y Citas) ──
// Reservas y Citas son funcionalidades independientes y casi siempre excluyentes;
// cada una tiene su PROPIO bot. La config vive en una columna jsonb del cliente:
//   · Reservas → clients.bot_config
//   · Citas    → clients.bot_config_citas
// Estos helpers son agnósticos de la columna (se pasa `columna`). El llamador
// (server action) es responsable de la sesión/permiso y de revalidatePath.

import type { SupabaseClient } from '@supabase/supabase-js'

export type BotColumna = 'bot_config' | 'bot_config_citas'

export interface BotConfig {
  token:                    string | null
  nombre:                   string | null
  activo:                   boolean
  webhook_registrado:       boolean
  notificar_owner_chat_id:  string | null
  confirmacion_automatica:  boolean
  webhook_secret:           string | null
  codigo_vinculo:           string | null
}

export const BOT_CONFIG_DEFAULTS: BotConfig = {
  token:                   null,
  nombre:                  null,
  activo:                  false,
  webhook_registrado:      false,
  notificar_owner_chat_id: null,
  confirmacion_automatica: false,
  webhook_secret:          null,
  codigo_vinculo:          null,
}

export function parseBotConfig(raw: unknown): BotConfig {
  if (!raw || typeof raw !== 'object') return { ...BOT_CONFIG_DEFAULTS }
  const c = raw as Record<string, unknown>
  try {
    return {
      token:                   typeof c.token                    === 'string'  ? c.token                    : null,
      nombre:                  typeof c.nombre                   === 'string'  ? c.nombre                   : null,
      activo:                  typeof c.activo                   === 'boolean' ? c.activo                   : false,
      webhook_registrado:      typeof c.webhook_registrado       === 'boolean' ? c.webhook_registrado       : false,
      notificar_owner_chat_id: typeof c.notificar_owner_chat_id  === 'string'  ? c.notificar_owner_chat_id  : null,
      confirmacion_automatica: typeof c.confirmacion_automatica  === 'boolean' ? c.confirmacion_automatica  : false,
      webhook_secret:          typeof c.webhook_secret           === 'string'  ? c.webhook_secret           : null,
      codigo_vinculo:          typeof c.codigo_vinculo           === 'string'  ? c.codigo_vinculo           : null,
    }
  } catch {
    return { ...BOT_CONFIG_DEFAULTS }
  }
}

function corto(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
}

// ── Guardar config + registrar webhook en Telegram ─────────────────────────────

export async function guardarBotConfigCol(
  db: SupabaseClient,
  client_id: string,
  columna: BotColumna,
  fields: { token: string | null; nombre: string | null; activo: boolean; confirmacionAutomatica: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const { token, nombre, activo, confirmacionAutomatica } = fields
  if (activo && !token) return { ok: false, error: 'El token del bot es obligatorio para activarlo.' }

  const { data: cliente } = await db.from('clients').select(columna).eq('client_id', client_id).single()
  const actual = parseBotConfig((cliente as Record<string, unknown> | null)?.[columna])

  // Secreto del webhook (verifica el origen) y código para que el dueño vincule
  // su chat (/start <codigo>). Se generan una vez y persisten.
  const webhookSecret = actual.webhook_secret ?? crypto.randomUUID().replace(/-/g, '')
  const codigoVinculo = actual.codigo_vinculo ?? corto()

  const nuevaConfig: BotConfig = {
    ...actual,
    token,
    nombre: nombre || actual.nombre,
    activo: token ? true : activo,
    confirmacion_automatica: confirmacionAutomatica,
    webhook_secret: token ? webhookSecret : actual.webhook_secret,
    codigo_vinculo: token ? codigoVinculo : actual.codigo_vinculo,
  }

  // Si no cambió nada y el webhook ya tiene secreto registrado, no tocamos la BD
  if (
    nuevaConfig.token === actual.token &&
    nuevaConfig.nombre === actual.nombre &&
    nuevaConfig.activo === actual.activo &&
    nuevaConfig.confirmacion_automatica === actual.confirmacion_automatica &&
    actual.webhook_secret
  ) {
    return { ok: true }
  }

  const { error } = await db.from('clients').update({ [columna]: nuevaConfig }).eq('client_id', client_id)
  if (error) return { ok: false, error: error.message }

  // Registrar webhook en Telegram con secret_token (POST, no en la query string)
  if (token) {
    const baseUrl = process.env.TELEGRAM_WEBHOOK_BASE_URL || 'https://claux.app'
    const webhookUrl = `${baseUrl}/api/telegram/webhook/${token}`
    try {
      const whRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          url:             webhookUrl,
          secret_token:    nuevaConfig.webhook_secret,
          allowed_updates: ['message', 'callback_query'],
        }),
      })
      const whData = await whRes.json() as { ok?: boolean; description?: string }
      nuevaConfig.webhook_registrado = !!whData.ok
      if (!whData.ok) return { ok: false, error: `Error al registrar el webhook: ${whData.description}` }
    } catch {
      return { ok: false, error: 'No se pudo conectar con Telegram para registrar el webhook.' }
    }
    await db.from('clients').update({ [columna]: nuevaConfig }).eq('client_id', client_id)
  }

  return { ok: true }
}

// ── Confirmación automática (independiente del bot) ────────────────────────────
// La confirmación automática aplica aunque NO haya bot (decide si una reserva/cita
// web nace CONFIRMADA o PENDIENTE), por eso se guarda por sí sola y sin exigir token.
// Fusiona solo ese campo en el jsonb, preservando token/nombre/webhook/etc.
export async function guardarConfirmacionCol(
  db: SupabaseClient, client_id: string, columna: BotColumna, confirmacionAutomatica: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { data: cliente } = await db.from('clients').select(columna).eq('client_id', client_id).single()
  const actual = parseBotConfig((cliente as Record<string, unknown> | null)?.[columna])
  if (actual.confirmacion_automatica === confirmacionAutomatica) return { ok: true }
  const { error } = await db.from('clients')
    .update({ [columna]: { ...actual, confirmacion_automatica: confirmacionAutomatica } })
    .eq('client_id', client_id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Activar / desactivar ───────────────────────────────────────────────────────

export async function toggleActivoBotCol(
  db: SupabaseClient, client_id: string, columna: BotColumna, activo: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { data: cliente } = await db.from('clients').select(columna).eq('client_id', client_id).single()
  const actual = parseBotConfig((cliente as Record<string, unknown> | null)?.[columna])
  if (!actual.token) return { ok: false, error: 'No hay un bot configurado.' }

  const { error } = await db.from('clients').update({ [columna]: { ...actual, activo } }).eq('client_id', client_id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Eliminar configuración del bot ─────────────────────────────────────────────

export async function eliminarBotConfigCol(
  db: SupabaseClient, client_id: string, columna: BotColumna,
): Promise<{ ok: boolean; error?: string }> {
  const { data: cliente } = await db.from('clients').select(columna).eq('client_id', client_id).single()
  const actual = parseBotConfig((cliente as Record<string, unknown> | null)?.[columna])

  // Quitar el webhook en Telegram (best-effort) antes de borrar la config
  if (actual.token) {
    try {
      await fetch(`https://api.telegram.org/bot${actual.token}/deleteWebhook`, { method: 'POST' })
    } catch { /* no-op */ }
  }

  const nuevaConfig: BotConfig = {
    ...BOT_CONFIG_DEFAULTS,
  }

  const { error } = await db.from('clients').update({ [columna]: nuevaConfig }).eq('client_id', client_id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
