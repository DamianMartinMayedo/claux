// ── Conector de salida de Telegram (Bot API) ──
// Capa baja compartida por el webhook (respuestas del bot) y las server actions
// de reservas (notificaciones al dueño y al cliente). Nunca lanza: los errores
// se registran y se devuelven como `false`, para no romper el flujo de reserva.

export interface ReplyMarkup {
  inline_keyboard?: { text: string; callback_data: string }[][]
}

export async function enviarMensaje(
  token: string,
  chatId: string,
  texto: string,
  markup?: ReplyMarkup,
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
      console.error('telegram sendMessage failed:', await res.text())
      return false
    }
    return true
  } catch (e) {
    console.error('telegram sendMessage error:', e)
    return false
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
