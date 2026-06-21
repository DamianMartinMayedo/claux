import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarMensaje, type BotContext, type BotResponse } from '@/lib/telegram/bot-engine'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  // Verificar que el token pertenece a un cliente
  const db = createAdminClient()
  const { data: clientes } = await db.from('clients')
    .select('client_id')
    .not('bot_config', 'is', null)

  const existe = ((clientes ?? []) as Record<string, unknown>[]).some(c => {
    const cfg = c.bot_config as Record<string, unknown> | null
    return cfg?.token === token
  })

  return NextResponse.json({ ok: existe })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  // Buscar cliente por token de bot (filtrar en JS para compatibilidad)
  const db = createAdminClient()
  const { data: clientes } = await db.from('clients')
    .select('client_id, nombre_empresa, slug, bot_config')
    .not('bot_config', 'is', null)

  const cliente = ((clientes ?? []) as Record<string, unknown>[]).find(c => {
    const cfg = c.bot_config as Record<string, unknown> | null
    return cfg?.token === token && cfg?.activo === true
  })
  if (!cliente) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  const ctx: BotContext = {
    client_id:      cliente.client_id as string,
    token,
    nombre_empresa: (cliente.nombre_empresa as string) ?? 'CLAUX',
    slug:           (cliente.slug as string) ?? null,
  }

  // Parsear update de Telegram
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  // Manejar callback de botón inline
  if (body.callback_query) {
    try {
      const cq = body.callback_query as Record<string, unknown>
      const chat_id   = String((cq.message as Record<string, unknown>)?.chat?.id ?? '')
      const callbackData = String(cq.data ?? '')

      if (!chat_id || !callbackData) {
        await answerCb(token, cq.id as string, 'Error')
        return NextResponse.json({ ok: false }, { status: 400 })
      }

      const respuesta = await manejarMensaje(ctx, callbackData, chat_id)

      await answerCb(token, cq.id as string, '✓')
      await enviarMensaje(token, chat_id, respuesta)
    } catch (e) {
      console.error('Callback error:', e)
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // Manejar mensaje de texto
  const message = body.message as Record<string, unknown> | undefined
  if (!message) {
    return NextResponse.json({ ok: false, error: 'No message' }, { status: 400 })
  }

  const chat_id = String(message.chat?.id ?? '')
  const texto   = String(message.text ?? '')

  if (!chat_id) {
    return NextResponse.json({ ok: false, error: 'No chat_id' }, { status: 400 })
  }

  // Guardar chat_id del dueño si es el primer mensaje
  const botCfg = (cliente.bot_config as Record<string, unknown>) ?? {}
  if (!botCfg.notificar_owner_chat_id) {
    await db.from('clients')
      .update({ bot_config: { ...botCfg, notificar_owner_chat_id: chat_id } })
      .eq('client_id', cliente.client_id)
  }

  const respuesta = await manejarMensaje(ctx, texto, chat_id)
  await enviarMensaje(token, chat_id, respuesta)

  return NextResponse.json({ ok: true })
}

async function answerCb(token: string, callbackQueryId: string, text?: string) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  })
}

async function enviarMensaje(token: string, chat_id: string, respuesta: BotResponse) {
  const body: Record<string, unknown> = {
    chat_id,
    text: respuesta.texto,
  }
  if (respuesta.markup) {
    body.reply_markup = respuesta.markup
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('sendMessage failed:', err)
  }
}
