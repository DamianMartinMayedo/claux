// ── Motor de bot de Telegram (agnóstico de canal) ──
// Lógica de botones, sin IA. La IA es capa opcional (add-on).

import { createAdminClient } from '@/lib/supabase/admin'

export interface BotContext {
  client_id: string
  token: string
  nombre_empresa: string
  slug: string | null
}

interface ReplyMarkup {
  inline_keyboard?: { text: string; callback_data: string }[][]
}

export interface BotResponse {
  texto: string
  markup?: ReplyMarkup
}

// ── Tipos de sesión ───────────────────────────────────────────────────────────

export type PasoReserva = 'inicio' | 'fecha' | 'hora' | 'personas' | 'nombre' | 'confirmar'

export interface DatosReserva {
  fecha?: string
  franja_id?: string
  franja_nombre?: string
  hora?: string
  personas?: number
  nombre?: string
}

export interface SesionInfo {
  paso: PasoReserva | null
  datos: DatosReserva
}

export async function cargarSesion(clientId: string, chatId: string): Promise<SesionInfo> {
  const db = createAdminClient()
  const { data } = await db.from('telegram_sessions')
    .select('paso, datos')
    .eq('session_id', chatId)
    .eq('client_id', clientId)
    .maybeSingle()
  return {
    paso: (data?.paso as PasoReserva) ?? null,
    datos: (data?.datos as DatosReserva) ?? {},
  }
}

export async function guardarSesion(clientId: string, chatId: string, paso: PasoReserva | null, datos: DatosReserva) {
  const db = createAdminClient()
  await db.from('telegram_sessions')
    .upsert({ session_id: chatId, client_id: clientId, chat_id: chatId, paso, datos, updated_at: new Date().toISOString() })
    .eq('session_id', chatId)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SALUDOS = ['hola', 'buenas', 'buenos días', 'buenas tardes', 'buenas noches', 'saludos', 'hey', 'ola']

function hoyISO(): string { return new Date().toISOString().split('T')[0] }
function formatFechaStr(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}
function formatHora(h: string): string { return h.substring(0, 5) }

function parseFecha(texto: string): string | null {
  const t = texto.trim().toLowerCase()
  const hoy = new Date()
  if (t === 'hoy') return hoyISO()
  if (t === 'mañana') { const d = new Date(hoy); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0] }
  if (t === 'pasado mañana' || t === 'pasado') { const d = new Date(hoy); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0] }
  const m1 = t.match(/^(\d{1,2})[/-](\d{1,2})$/)
  if (m1) {
    const dd = parseInt(m1[1]), mm = parseInt(m1[2])
    const f = new Date(hoy.getFullYear(), mm - 1, dd)
    if (f.getMonth() === mm - 1 && f.getDate() === dd) return f.toISOString().split('T')[0]
  }
  const m2 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m2) {
    const f = new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]))
    if (!isNaN(f.getTime())) return t
  }
  return null
}

// ── Entrada principal ─────────────────────────────────────────────────────────

export async function manejarMensaje(
  ctx: BotContext,
  texto: string,
  chat_id: string,
): Promise<BotResponse> {
  const t = texto.trim().toLowerCase()

  // Si hay flujo de reserva activo, continuar
  const sesion = await cargarSesion(ctx.client_id, chat_id)
  if (sesion.paso) {
    if (t === 'cancelar_flujo' || t === 'cancelar' || t === '/cancelar') {
      await guardarSesion(ctx.client_id, chat_id, null, {})
      return bienvenida(ctx)
    }
    if (t === 'reservar') {
      await guardarSesion(ctx.client_id, chat_id, 'inicio', {})
      return promptFecha()
    }
    return manejarPasoReserva(ctx, chat_id, sesion, texto.trim())
  }

  if (t === '/start' || SALUDOS.some(s => t.startsWith(s))) return bienvenida(ctx)
  if (t === 'reservar' || t === '/reservar') return iniciarReserva(ctx, chat_id)
  if (t === 'cancelar_flujo') return bienvenida(ctx)
  if (t === 'carta'   || t === 'menu' || t === 'menú') return mostrarCarta(ctx)
  if (t === 'horarios'|| t === 'horario') return mostrarHorarios(ctx)
  if (t === 'ubicacion'|| t === 'ubicación' || t === 'donde' || t === 'dónde') return mostrarUbicacion(ctx)
  if (t === 'ayuda'   || t === 'help') return mostrarAyuda(ctx)

  return {
    texto: `Hola, soy el bot de ${ctx.nombre_empresa}. ¿En qué puedo ayudarte?`,
    markup: tecladoPrincipal(),
  }
}

// ── Bienvenida ────────────────────────────────────────────────────────────────

function bienvenida(ctx: BotContext): BotResponse {
  return {
    texto: `¡Bienvenido a ${ctx.nombre_empresa}! 🍽️\n\n¿Qué quieres hacer?`,
    markup: tecladoPrincipal(),
  }
}

// ── Iniciar flujo de reserva ──────────────────────────────────────────────────

async function iniciarReserva(ctx: BotContext, chatId: string): Promise<BotResponse> {
  await guardarSesion(ctx.client_id, chatId, 'inicio', {})
  return promptFecha()
}

function promptFecha(): BotResponse {
  return {
    texto: '¿Para qué día quieres reservar?',
    markup: {
      inline_keyboard: [
        [{ text: 'Hoy', callback_data: 'fecha:hoy' }, { text: 'Mañana', callback_data: 'fecha:mañana' }],
        [{ text: 'Otro día', callback_data: 'fecha:otro' }],
        [{ text: 'Cancelar', callback_data: 'cancelar_flujo' }],
      ],
    },
  }
}

// ── Helper: mostrar slots horarios disponibles ────────────────────────────────

async function mostrarSlots(ctx: BotContext, chatId: string, datos: DatosReserva): Promise<BotResponse> {
  const db = createAdminClient()
  const { data: franjas } = await db.from('reserva_franjas')
    .select('franja_id, nombre, hora_inicio, hora_fin, duracion_minutos')
    .eq('client_id', ctx.client_id)
    .eq('activa', true)
    .order('hora_inicio')

  if (!franjas || franjas.length === 0) {
    await guardarSesion(ctx.client_id, chatId, null, {})
    return { texto: 'No hay horarios disponibles todavía. Vuelve pronto.', markup: tecladoPrincipal() }
  }

  const slots: { hora: string; franja_id: string; franja_nombre: string }[] = []
  const fecha = datos.fecha!
  for (const f of (franjas as { franja_id: string; nombre: string; hora_inicio: string | null; hora_fin: string | null; duracion_minutos: number }[])) {
    if (!f.hora_inicio || !f.hora_fin) continue
    const [hIni, mIni] = f.hora_inicio.split(':').map(Number)
    const [hFin, mFin] = f.hora_fin.split(':').map(Number)
    const ini = hIni * 60 + mIni
    const fin = hFin * 60 + mFin
    const ahora = new Date()
    const minsAhora = ahora.getHours() * 60 + ahora.getMinutes()
    for (let t = ini; t < fin; t += 30) {
      if (fecha === hoyISO() && t <= minsAhora) continue
      const hh = String(Math.floor(t / 60)).padStart(2, '0')
      const mm = String(t % 60).padStart(2, '0')
      slots.push({ hora: `${hh}:${mm}`, franja_id: f.franja_id, franja_nombre: f.nombre })
    }
  }

  if (slots.length === 0) {
    await guardarSesion(ctx.client_id, chatId, null, {})
    return { texto: 'No hay horarios disponibles para ese día.', markup: tecladoPrincipal() }
  }

  const botones: { text: string; callback_data: string }[][] = []
  for (let i = 0; i < Math.min(slots.length, 24); i++) {
    if (i % 3 === 0) botones.push([])
    const s = slots[i]
    botones[botones.length - 1].push({
      text: formatHora(s.hora),
      callback_data: `slot:${s.franja_id}:${s.hora}`,
    })
  }
  botones.push([{ text: '← Volver', callback_data: 'reservar' }])

  await guardarSesion(ctx.client_id, chatId, 'hora', datos)
  return {
    texto: `📅 ${formatFechaStr(fecha)}\n\nElige una hora:`,
    markup: { inline_keyboard: botones },
  }
}

// ── Máquina de pasos de reserva ───────────────────────────────────────────────

export async function manejarPasoReserva(
  ctx: BotContext,
  chatId: string,
  sesion: SesionInfo,
  texto: string,
): Promise<BotResponse> {
  const db = createAdminClient()
  const paso = sesion.paso!
  let datos = { ...sesion.datos }

  // ── FECHA ───────────────────────────────────────────────────────────────────
  if (paso === 'inicio') {
    if (texto === 'fecha:otro') {
      await guardarSesion(ctx.client_id, chatId, 'fecha', datos)
      return { texto: 'Escribe la fecha (ej: 25/06 o 2026-06-25):' }
    }
    if (texto.startsWith('fecha:')) {
      const tag = texto.replace('fecha:', '')
      if (tag === 'hoy') datos.fecha = hoyISO()
      else if (tag === 'mañana') {
        const d = new Date(); d.setDate(d.getDate() + 1)
        datos.fecha = d.toISOString().split('T')[0]
      }
    } else {
      const pf = parseFecha(texto)
      if (!pf) return { texto: 'No entiendo esa fecha. Escribe DD/MM o YYYY-MM-DD.', markup: tecladoFecha() }
      if (pf < hoyISO()) return { texto: 'Esa fecha ya pasó. Elige una fecha futura.', markup: tecladoFecha() }
      datos.fecha = pf
    }

    return mostrarSlots(ctx, chatId, datos)
  }

  // ── FECHA (paso fecha, para texto libre) ────────────────────────────────────
  if (paso === 'fecha') {
    const pf = parseFecha(texto)
    if (!pf) return { texto: 'No entiendo esa fecha. Escribe DD/MM o YYYY-MM-DD.', markup: tecladoFecha() }
    if (pf < hoyISO()) return { texto: 'Esa fecha ya pasó. Elige una fecha futura.', markup: tecladoFecha() }
    datos.fecha = pf
    return mostrarSlots(ctx, chatId, datos)
  }

  // ── HORA ────────────────────────────────────────────────────────────────────
  if (paso === 'hora') {
    if (!texto.startsWith('slot:')) {
      return { texto: 'Elige una hora de los botones.' }
    }
    const parts = texto.replace('slot:', '').split(':')
    // Formato: FRANJA_ID:HH:MM (la FRANJA_ID no contiene ':')
    datos.franja_id = parts[0]
    datos.hora = parts.slice(1).join(':')
    datos.franja_nombre = ''

    await guardarSesion(ctx.client_id, chatId, 'personas', datos)
    return {
      texto: '¿Cuántas personas?',
      markup: {
        inline_keyboard: [
          [{ text: '1', callback_data: 'personas:1' }, { text: '2', callback_data: 'personas:2' }, { text: '3', callback_data: 'personas:3' }],
          [{ text: '4', callback_data: 'personas:4' }, { text: '5', callback_data: 'personas:5' }, { text: '6+', callback_data: 'personas:6' }],
          [{ text: '← Volver', callback_data: 'reservar' }],
        ],
      },
    }
  }

  // ── PERSONAS ────────────────────────────────────────────────────────────────
  if (paso === 'personas') {
    const n = parseInt(texto.replace('personas:', ''))
    if (isNaN(n) || n < 1) return { texto: 'Dime un número válido (1-20).' }
    datos.personas = Math.min(n, 20)

    await guardarSesion(ctx.client_id, chatId, 'nombre', datos)
    return { texto: '¿A nombre de quién?' }
  }

  // ── NOMBRE ──────────────────────────────────────────────────────────────────
  if (paso === 'nombre') {
    if (texto.length < 2) return { texto: 'El nombre debe tener al menos 2 letras.' }
    datos.nombre = texto

    // Confirmación automática
    const { data: cliente } = await db.from('clients')
      .select('bot_config')
      .eq('client_id', ctx.client_id)
      .single()
    const botCfg = (cliente?.bot_config as Record<string, unknown>) ?? {}
    const confirmAuto = !!botCfg.confirmacion_automatica

    await guardarSesion(ctx.client_id, chatId, 'confirmar', datos)

    const autoText = confirmAuto ? '\n✅ Confirmación automática: tu reserva se confirma al instante.' : '\nTe confirmaremos por este mismo chat.'

    return {
      texto: `📋 *Resumen*\n\n📅 ${formatFechaStr(datos.fecha!)}\n🕐 ${formatHora(datos.hora!)}\n👥 ${datos.personas} persona${datos.personas !== 1 ? 's' : ''}\n✏️ ${datos.nombre}${autoText}\n\n¿Confirmar reserva?`,
      markup: {
        inline_keyboard: [
          [{ text: '✅ Confirmar', callback_data: 'confirmar_reserva' }],
          [{ text: '← Cancelar', callback_data: 'cancelar_flujo' }],
        ],
      },
    }
  }

  // ── CONFIRMAR ───────────────────────────────────────────────────────────────
  if (paso === 'confirmar') {
    if (texto !== 'confirmar_reserva') {
      return { texto: 'Usa el botón Confirmar o Cancelar.' }
    }

    const { data: cliente } = await db.from('clients')
      .select('bot_config')
      .eq('client_id', ctx.client_id)
      .single()
    const botCfg = (cliente?.bot_config as Record<string, unknown>) ?? {}
    const confirmAuto = !!botCfg.confirmacion_automatica

    const reservaId = `RES-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`

    const { error: rpcErr, data: rpcData } = await db.rpc('res_crear_reserva', {
      p_client_id:               ctx.client_id,
      p_franja_id:               datos.franja_id!,
      p_fecha:                   datos.fecha!,
      p_hora:                    datos.hora! + ':00',
      p_personas:                datos.personas!,
      p_nombre_cliente:          datos.nombre!,
      p_telefono:                null,
      p_notas:                   null,
      p_canal:                   'bot',
      p_confirmacion_automatica: confirmAuto,
      p_reserva_id:              reservaId,
    })

    await guardarSesion(ctx.client_id, chatId, null, {})

    if (rpcErr) {
      return { texto: `❌ No se pudo crear la reserva.\n\n${rpcErr.message}`, markup: tecladoPrincipal() }
    }

    const result = (rpcData as { ok?: boolean; error?: string; reserva_id?: string }) ?? {}
    if (!result.ok) {
      return { texto: `❌ ${result.error ?? 'Error al crear la reserva.'}`, markup: tecladoPrincipal() }
    }

    const estado = confirmAuto ? 'confirmada' : 'pendiente de confirmación'
    return {
      texto: `✅ ¡Reserva ${estado}!\n\n📅 ${formatFechaStr(datos.fecha!)}\n🕐 ${formatHora(datos.hora!)}\n👥 ${datos.personas} persona${datos.personas !== 1 ? 's' : ''}\n✏️ ${datos.nombre}\n\nTe avisaremos por aquí.`,
      markup: tecladoPrincipal(),
    }
  }

  return { texto: 'Algo salió mal. Usa /start para volver.', markup: tecladoPrincipal() }
}

// ── Mostrar carta ─────────────────────────────────────────────────────────────

function mostrarCarta(_ctx: BotContext): BotResponse {
  return { texto: '📋 La carta digital estará disponible próximamente.', markup: tecladoPrincipal() }
}

// ── Mostrar horarios ──────────────────────────────────────────────────────────

async function mostrarHorarios(ctx: BotContext): Promise<BotResponse> {
  const db = createAdminClient()
  const { data: franjas } = await db.from('reserva_franjas')
    .select('nombre, hora_inicio, hora_fin')
    .eq('client_id', ctx.client_id)
    .eq('activa', true)
    .order('hora_inicio')

  if (!franjas || franjas.length === 0) {
    return { texto: 'Horario no disponible todavía.', markup: tecladoPrincipal() }
  }

  const lista = (franjas as { nombre: string; hora_inicio: string | null; hora_fin: string | null }[])
    .map(f => `• ${f.nombre}: ${f.hora_inicio?.substring(0, 5) ?? '—'} – ${f.hora_fin?.substring(0, 5) ?? '—'}`)
    .join('\n')

  return { texto: `🕐 Horarios de ${ctx.nombre_empresa}\n\n${lista}`, markup: tecladoPrincipal() }
}

// ── Mostrar ubicación ─────────────────────────────────────────────────────────

function mostrarUbicacion(ctx: BotContext): BotResponse {
  return { texto: '📍 La ubicación estará disponible próximamente.', markup: tecladoPrincipal() }
}

// ── Ayuda ─────────────────────────────────────────────────────────────────────

function mostrarAyuda(ctx: BotContext): BotResponse {
  return {
    texto: `Bot de ${ctx.nombre_empresa}\n\nPuedes:\n• Reservar mesa\n• Ver la carta\n• Consultar horarios\n• Ver la ubicación`,
    markup: tecladoPrincipal(),
  }
}

// ── Teclados ──────────────────────────────────────────────────────────────────

function tecladoPrincipal(): ReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: '🍽️ Reservar', callback_data: 'reservar' }, { text: '📋 Carta', callback_data: 'carta' }],
      [{ text: '🕐 Horarios', callback_data: 'horarios' }, { text: '📍 Ubicación', callback_data: 'ubicacion' }],
    ],
  }
}

function tecladoFecha(): ReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Hoy', callback_data: 'fecha:hoy' }, { text: 'Mañana', callback_data: 'fecha:mañana' }],
      [{ text: 'Otro día', callback_data: 'fecha:otro' }],
      [{ text: '← Cancelar', callback_data: 'cancelar_flujo' }],
    ],
  }
}
