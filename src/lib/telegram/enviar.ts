// ── Conector de salida de Telegram (Bot API) ──
// Capa baja compartida por el webhook (respuestas del bot) y las server actions
// de reservas (notificaciones al dueño y al cliente). Nunca lanza: los errores
// se registran y se devuelven como `false`, para no romper el flujo de reserva.

import { createAdminClient } from '@/lib/supabase/admin'

export interface ReplyMarkup {
  inline_keyboard?: { text: string; callback_data: string }[][]
}

/** Para qué era el mensaje. Sirve para leer el log sin adivinar. */
export type TipoEnvio = 'reserva_nueva' | 'estado' | 'vinculo' | 'prueba' | 'recordatorio' | 'bot'

/**
 * De quién es el mensaje, para poder registrarlo (TG-2).
 *
 * `enviarMensaje` tragaba el error y devolvía `false` a un `console.error`, y NINGÚN
 * llamador miraba el resultado: si el dueño bloqueaba el bot, revocaba el token o
 * cambiaba de cuenta, los avisos se perdían para siempre y en silencio. El correo
 * tiene `emails_log`; Telegram no tenía nada.
 */
export interface OrigenEnvio {
  clientId: string
  columna:  'bot_config' | 'bot_config_citas'
  tipo:     TipoEnvio
}

// Registrar NUNCA puede tumbar una reserva: si el log falla, se ignora.
async function registrar(o: OrigenEnvio, chatId: string, ok: boolean, error?: string): Promise<void> {
  try {
    await createAdminClient().from('telegram_envios').insert({
      client_id: o.clientId, columna: o.columna, chat_id: chatId,
      tipo: o.tipo, ok, error: error?.slice(0, 500) ?? null,
    })
  } catch { /* no-op */ }
}

export async function enviarMensaje(
  token: string,
  chatId: string,
  texto: string,
  markup?: ReplyMarkup,
  origen?: OrigenEnvio,
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { chat_id: chatId, text: texto }
    if (markup) body.reply_markup = markup
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!res.ok) {
      const detalle = await res.text()
      console.error('telegram sendMessage failed:', detalle)
      if (origen) await registrar(origen, chatId, false, detalle)
      return false
    }
    if (origen) await registrar(origen, chatId, true)
    return true
  } catch (e) {
    console.error('telegram sendMessage error:', e)
    if (origen) await registrar(origen, chatId, false, String(e))
    return false
  }
}

// Indicador de actividad ("escribiendo…"). Telegram lo muestra ~5 s o hasta el
// siguiente mensaje. Se envía antes de una llamada a IA para que el cliente vea
// que el bot está trabajando. Nunca lanza: si falla, se ignora.
export async function enviarAccion(
  token: string,
  chatId: string,
  action: 'typing' = 'typing',
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, action }),
    })
  } catch (e) {
    console.error('telegram sendChatAction error:', e)
  }
}

export async function answerCallback(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ callback_query_id: callbackQueryId, text }),
    })
  } catch (e) {
    console.error('telegram answerCallbackQuery error:', e)
  }
}
