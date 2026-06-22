import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { manejarMensaje, type BotContext } from '@/lib/telegram/bot-engine'
import { manejarMensajeCitas } from '@/lib/telegram/bot-engine-citas'
import { enviarMensaje, answerCallback } from '@/lib/telegram/enviar'
import { transicionarEstado, type EstadoReserva } from '@/lib/reservas/estado'

interface TgChat { id?: number | string }
interface TgMessage { chat?: TgChat; text?: string }
interface TgCallback { id?: string; data?: string; message?: TgMessage }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const db = createAdminClient()

  // 1. Resolver el negocio por token. Reservas y Citas tienen bots INDEPENDIENTES
  //    (columnas `bot_config` / `bot_config_citas`); probamos ambas por su índice.
  let cliente: { client_id: string; nombre_empresa: string | null; slug: string | null } | null = null
  let cfg: Record<string, unknown> = {}
  let columna: 'bot_config' | 'bot_config_citas' = 'bot_config'
  let modulo: 'reservas' | 'citas' = 'reservas'

  const rRes = await db.from('clients')
    .select('client_id, nombre_empresa, slug, bot_config')
    .eq('bot_config->>token', token).maybeSingle()
  if (rRes.data) {
    cliente = { client_id: rRes.data.client_id, nombre_empresa: rRes.data.nombre_empresa, slug: rRes.data.slug }
    cfg = (rRes.data.bot_config as Record<string, unknown>) ?? {}
    columna = 'bot_config'; modulo = 'reservas'
  } else {
    const rCit = await db.from('clients')
      .select('client_id, nombre_empresa, slug, bot_config_citas')
      .eq('bot_config_citas->>token', token).maybeSingle()
    if (rCit.data) {
      cliente = { client_id: rCit.data.client_id, nombre_empresa: rCit.data.nombre_empresa, slug: rCit.data.slug }
      cfg = (rCit.data.bot_config_citas as Record<string, unknown>) ?? {}
      columna = 'bot_config_citas'; modulo = 'citas'
    }
  }

  if (!cliente || cfg.activo !== true) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  // 2. Verificar que el update viene de Telegram (secret token del webhook).
  //    Bots configurados antes de tener secret siguen operando hasta re-guardarse.
  const secret = typeof cfg.webhook_secret === 'string' ? cfg.webhook_secret : null
  if (secret && req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 401 })
  }

  // 3. Parsear el update
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  // 4. Dedupe: Telegram reintenta ante no-200/timeout → no procesar dos veces
  const updateId = typeof body.update_id === 'number' ? body.update_id : null
  if (updateId !== null) {
    const { data: nuevo } = await db.from('telegram_updates')
      .upsert({ client_id: cliente.client_id, update_id: updateId }, { onConflict: 'client_id,update_id', ignoreDuplicates: true })
      .select()
    if (!nuevo || nuevo.length === 0) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
  }

  // 4b. Limpieza ocasional de sesiones viejas (>1 día)
  if (Math.random() < 0.1) {
    const corte = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    await db.from('telegram_sessions').delete().lt('updated_at', corte)
  }

  const ctx: BotContext = {
    client_id:      cliente.client_id as string,
    token,
    nombre_empresa: (cliente.nombre_empresa as string) ?? 'CLAUX',
    slug:           (cliente.slug as string) ?? null,
  }

  // 5. Callback de botón inline
  if (body.callback_query) {
    const cq = body.callback_query as TgCallback
    const chat_id = String(cq.message?.chat?.id ?? '')
    const data    = String(cq.data ?? '')
    const cqId    = String(cq.id ?? '')

    if (!chat_id || !data) {
      await answerCallback(token, cqId, 'Error')
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    // 5a. Acción del DUEÑO sobre una reserva: res:<ESTADO>:<reserva_id>
    if (data.startsWith('res:')) {
      const ownerChat = typeof cfg.notificar_owner_chat_id === 'string' ? cfg.notificar_owner_chat_id : null
      if (!ownerChat || chat_id !== ownerChat) {
        await answerCallback(token, cqId, 'No autorizado')
        return NextResponse.json({ ok: false }, { status: 403 })
      }
      const [, estado, reservaId] = data.split(':')
      const r = await transicionarEstado(db, ctx.client_id, reservaId, estado as EstadoReserva, ctx.nombre_empresa, { token, activo: true })
      await answerCallback(token, cqId, r.ok ? '✓ Hecho' : (r.error ?? 'Error'))
      await enviarMensaje(token, chat_id, r.ok
        ? `Reserva ${estado === 'CONFIRMADA' ? 'confirmada ✅' : 'rechazada ✕'}.`
        : `No se pudo: ${r.error}`)
      return NextResponse.json({ ok: r.ok })
    }

    // 5b. Flujo conversacional (según la funcionalidad del bot)
    try {
      const respuesta = modulo === 'citas'
        ? await manejarMensajeCitas(ctx, data, chat_id)
        : await manejarMensaje(ctx, data, chat_id)
      await answerCallback(token, cqId, '✓')
      await enviarMensaje(token, chat_id, respuesta.texto, respuesta.markup)
    } catch (e) {
      console.error('Callback error:', e)
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // 6. Mensaje de texto
  const message = body.message as TgMessage | undefined
  if (!message) {
    return NextResponse.json({ ok: false, error: 'No message' }, { status: 400 })
  }
  const chat_id = String(message.chat?.id ?? '')
  const texto   = String(message.text ?? '')
  if (!chat_id) {
    return NextResponse.json({ ok: false, error: 'No chat_id' }, { status: 400 })
  }

  // 6a. Vinculación del dueño con código: /start <codigo>
  const codigo = typeof cfg.codigo_vinculo === 'string' ? cfg.codigo_vinculo : null
  const startMatch = texto.trim().match(/^\/start\s+(.+)$/i)
  if (codigo && startMatch && startMatch[1].trim() === codigo) {
    if (!cfg.notificar_owner_chat_id) {
      await db.from('clients')
        .update({ [columna]: { ...cfg, notificar_owner_chat_id: chat_id } })
        .eq('client_id', cliente.client_id)
    }
    await enviarMensaje(token, chat_id, `✅ Bot vinculado. Aquí recibirás los avisos de ${modulo === 'citas' ? 'citas' : 'reservas'} nuevas.`)
    return NextResponse.json({ ok: true })
  }

  const respuesta = modulo === 'citas'
    ? await manejarMensajeCitas(ctx, texto, chat_id)
    : await manejarMensaje(ctx, texto, chat_id)
  await enviarMensaje(token, chat_id, respuesta.texto, respuesta.markup)
  return NextResponse.json({ ok: true })
}
