// ── Motor de bot de Telegram (agnóstico de canal) ──
// Por defecto, flujo de botones determinista. Si el negocio tiene el addon de IA
// y el dueño la activa (bot_config.ia_activa), el bot atiende en lenguaje natural
// (manejarConversacionReserva): la IA conversa y extrae datos, pero la reserva se
// crea SIEMPRE por RPC al pulsar el botón de confirmar (la IA nunca la crea).

import { createAdminClient } from '@/lib/supabase/admin'
import { hoyEnTz, ahoraEnTz, sumarDias } from '@/lib/fecha-tz'
import { notificarReservaNueva } from '@/lib/reservas/estado'
import { tieneModulo } from '@/lib/modulos'
import { parseBotConfig } from '@/lib/reservas/bot-config'
import { conversarReserva, type TurnoConv } from '@/lib/ia/telegram'
import { enviarAccion } from './enviar'

export interface BotContext {
  client_id: string
  token: string
  nombre_empresa: string
  slug: string | null
  modulos: string[]   // modulos_activos del cliente (gating de carta, etc.)
  iaActiva: boolean   // addon asistente_ia contratado Y ia_activa en el bot
}

interface ReplyMarkup {
  inline_keyboard?: { text: string; callback_data: string }[][]
}

export interface BotResponse {
  texto: string
  markup?: ReplyMarkup
}

// ── Tipos de sesión ───────────────────────────────────────────────────────────

// 'ia' = conversación en lenguaje natural en curso (modo asistente IA). El resto
// son pasos del flujo de botones determinista.
export type PasoReserva = 'inicio' | 'fecha' | 'hora' | 'personas' | 'nombre' | 'confirmar' | 'ia'

export interface DatosReserva {
  fecha?: string
  franja_id?: string
  franja_nombre?: string
  hora?: string
  personas?: number
  nombre?: string
  // Solo en modo IA: historial corto de la conversación, para coherencia entre
  // turnos. Se descarta al pasar a 'confirmar'; la creación por RPC no lo usa.
  _hist?: TurnoConv[]
}

export interface SesionInfo {
  paso: PasoReserva | null
  datos: DatosReserva
}

export async function cargarSesion(clientId: string, chatId: string): Promise<SesionInfo> {
  const db = createAdminClient()
  const { data } = await db.from('telegram_sessions')
    .select('paso, datos')
    .eq('client_id', clientId)
    .eq('chat_id', chatId)
    .eq('modulo', 'reservas')
    .maybeSingle()
  return {
    paso: (data?.paso as PasoReserva) ?? null,
    datos: (data?.datos as DatosReserva) ?? {},
  }
}

export async function guardarSesion(clientId: string, chatId: string, paso: PasoReserva | null, datos: DatosReserva) {
  const db = createAdminClient()
  await db.from('telegram_sessions')
    .upsert({ client_id: clientId, chat_id: chatId, modulo: 'reservas', paso, datos, updated_at: new Date().toISOString() },
            { onConflict: 'client_id,chat_id,modulo' })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SALUDOS = ['hola', 'buenas', 'buenos días', 'buenas tardes', 'buenas noches', 'saludos', 'hey', 'ola']

function hoyISO(): string { return hoyEnTz() } // hoy en la zona del negocio (America/Havana)
function isodowDe(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() // 0=Dom … 6=Sáb
  return dow === 0 ? 7 : dow                  // 1=Lun … 7=Dom
}
export function formatFechaStr(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}
export function formatHora(h: string): string { return h.substring(0, 5) }

export function parseFecha(texto: string): string | null {
  const t = texto.trim().toLowerCase()
  const hoyStr = hoyISO() // YYYY-MM-DD en la zona del negocio
  if (t === 'hoy') return hoyStr
  if (t === 'mañana') return sumarDias(hoyStr, 1)
  if (t === 'pasado mañana' || t === 'pasado') return sumarDias(hoyStr, 2)
  const m1 = t.match(/^(\d{1,2})[/-](\d{1,2})$/)
  if (m1) {
    const dd = parseInt(m1[1]), mm = parseInt(m1[2])
    const year = parseInt(hoyStr.split('-')[0], 10)
    const f = new Date(Date.UTC(year, mm - 1, dd))
    if (f.getUTCMonth() === mm - 1 && f.getUTCDate() === dd) return f.toISOString().split('T')[0]
  }
  const m2 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m2) {
    const f = new Date(Date.UTC(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3])))
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
  const esCancelar = t === 'cancelar_flujo' || t === 'cancelar' || t === '/cancelar'
  const esSaludo   = t === '/start' || SALUDOS.includes(t)

  const sesion = await cargarSesion(ctx.client_id, chat_id)

  // ══ MODO IA: 100% conversacional, sin teclados salvo el ✅ Confirmar final ══
  if (ctx.iaActiva) {
    // Cierre por botón: en 'confirmar' solo valen ✅ Confirmar / ← Cancelar.
    if (sesion.paso === 'confirmar') {
      if (esCancelar) { await guardarSesion(ctx.client_id, chat_id, null, {}); return saludoIa(ctx) }
      return manejarPasoReserva(ctx, chat_id, sesion, texto.trim())
    }
    if (esCancelar) { await guardarSesion(ctx.client_id, chat_id, null, {}); return saludoIa(ctx) }
    // Saludo puro / iniciar → saludo directo, sin coste de IA ni botones.
    if (esSaludo) {
      if (sesion.paso) await guardarSesion(ctx.client_id, chat_id, null, {})
      return saludoIa(ctx)
    }
    // Todo lo demás lo lleva el asistente en lenguaje natural.
    const datosPrev = sesion.paso === 'ia' ? sesion.datos : {}
    const conv = await manejarConversacionReserva(ctx, chat_id, datosPrev, texto.trim())
    if (conv) return conv
    return { texto: 'Perdona, ahora mismo no puedo responder. Prueba de nuevo en un momento.' }
  }

  // ══ MODO BOTONES (sin addon de IA) ══
  // Si quedó un estado 'ia' de cuando la IA estaba activa, lo descartamos.
  if (sesion.paso === 'ia') await guardarSesion(ctx.client_id, chat_id, null, {})

  if (sesion.paso && sesion.paso !== 'ia') {
    if (esCancelar) {
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
  if (t === 'ayuda'   || t === 'help') return mostrarAyuda(ctx)

  return {
    texto: `Hola, soy el bot de ${ctx.nombre_empresa}. ¿En qué puedo ayudarte?`,
    markup: tecladoPrincipal(ctx),
  }
}

// Saludo conversacional del modo IA (sin botones, instantáneo, sin coste de IA).
function saludoIa(ctx: BotContext): BotResponse {
  const carta = tieneCarta(ctx) && ctx.slug ? ' Si quieres, también te paso la carta.' : ''
  return {
    texto: `¡Hola! 👋 Soy el asistente de ${ctx.nombre_empresa}. ¿Quieres reservar? Dime el día, la hora y para cuántas personas y te lo preparo.${carta}`,
  }
}

// ── Bienvenida ────────────────────────────────────────────────────────────────

function bienvenida(ctx: BotContext): BotResponse {
  return {
    texto: `¡Bienvenido a ${ctx.nombre_empresa}!\n\n¿Qué quieres hacer?`,
    markup: tecladoPrincipal(ctx),
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

// ── Helper: calcular slots horarios libres de un día (reutilizado por botones e IA) ──

export interface SlotReserva { hora: string; franja_id: string; franja_nombre: string }

export async function slotsDisponiblesReserva(clientId: string, fecha: string): Promise<SlotReserva[]> {
  const db = createAdminClient()
  const { data: franjas } = await db.from('reserva_franjas')
    .select('franja_id, nombre, hora_inicio, hora_fin, duracion_minutos, dias_semana')
    .eq('client_id', clientId)
    .eq('activa', true)
    .order('hora_inicio')

  if (!franjas || franjas.length === 0) return []

  const slots: SlotReserva[] = []
  const isodow = isodowDe(fecha)
  const [hAhora, mAhora] = ahoraEnTz().split(':').map(Number) // ahora en la zona del negocio
  const minsAhora = hAhora * 60 + mAhora
  for (const f of (franjas as { franja_id: string; nombre: string; hora_inicio: string | null; hora_fin: string | null; duracion_minutos: number; dias_semana: number[] | null }[])) {
    // Respetar los días de la semana del turno (NULL/vacío = todos los días)
    if (f.dias_semana && f.dias_semana.length > 0 && !f.dias_semana.includes(isodow)) continue
    if (!f.hora_inicio || !f.hora_fin) continue
    const [hIni, mIni] = f.hora_inicio.split(':').map(Number)
    const [hFin, mFin] = f.hora_fin.split(':').map(Number)
    const ini = hIni * 60 + mIni
    const fin = hFin * 60 + mFin
    for (let t = ini; t < fin; t += 30) {
      if (fecha === hoyISO() && t <= minsAhora) continue
      const hh = String(Math.floor(t / 60)).padStart(2, '0')
      const mm = String(t % 60).padStart(2, '0')
      slots.push({ hora: `${hh}:${mm}`, franja_id: f.franja_id, franja_nombre: f.nombre })
    }
  }
  return slots
}

// ── Helper: mostrar slots horarios disponibles (flujo de botones) ──────────────

async function mostrarSlots(ctx: BotContext, chatId: string, datos: DatosReserva): Promise<BotResponse> {
  const fecha = datos.fecha!
  const slots = await slotsDisponiblesReserva(ctx.client_id, fecha)

  if (slots.length === 0) {
    await guardarSesion(ctx.client_id, chatId, null, {})
    return { texto: 'No hay horarios disponibles para ese día.', markup: tecladoPrincipal(ctx) }
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

// ── Resumen + botón de confirmación (compartido por botones e IA) ──────────────
// Guarda la sesión en 'confirmar' (descartando el historial de IA) y devuelve el
// resumen con los botones ✅ Confirmar / ← Cancelar. La reserva NO se crea aquí:
// se crea en el paso 'confirmar' al pulsar el botón (misma ruta RPC de siempre).
async function resumenConfirmacion(ctx: BotContext, chatId: string, datos: DatosReserva): Promise<BotResponse> {
  const db = createAdminClient()
  const { data: cliente } = await db.from('clients').select('bot_config').eq('client_id', ctx.client_id).single()
  const confirmAuto = !!parseBotConfig(cliente?.bot_config).confirmacion_automatica

  const limpio: DatosReserva = {
    fecha: datos.fecha, franja_id: datos.franja_id, franja_nombre: datos.franja_nombre,
    hora: datos.hora, personas: datos.personas, nombre: datos.nombre,
  }
  await guardarSesion(ctx.client_id, chatId, 'confirmar', limpio)

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

// ── Modo IA: asistente conversacional ──────────────────────────────────────────

// Resumen de horarios del negocio (texto para el contexto de la IA).
async function horariosResumen(clientId: string): Promise<string> {
  const db = createAdminClient()
  const { data: franjas } = await db.from('reserva_franjas')
    .select('nombre, hora_inicio, hora_fin').eq('client_id', clientId).eq('activa', true).order('hora_inicio')
  const lista = (franjas ?? []) as { nombre: string; hora_inicio: string | null; hora_fin: string | null }[]
  if (lista.length === 0) return ''
  return lista.map(f => `${f.nombre} ${f.hora_inicio?.substring(0, 5) ?? '—'}–${f.hora_fin?.substring(0, 5) ?? '—'}`).join('; ')
}

// Turno conversacional: 1 llamada a IA, valida los datos contra disponibilidad
// real y, cuando están completos, pasa a resumen + botón. Devuelve null si la IA
// no está configurada o falla (el llamador cae al flujo de botones).
async function manejarConversacionReserva(
  ctx: BotContext, chatId: string, datosPrev: DatosReserva, texto: string,
): Promise<BotResponse | null> {
  // "Escribiendo…" mientras preparamos el contexto y llamamos a la IA (varios seg).
  await enviarAccion(ctx.token, chatId)

  const datos: DatosReserva = { ...datosPrev }
  const hist: TurnoConv[] = Array.isArray(datos._hist) ? datos._hist : []

  // Disponibilidad real: priorizamos una fecha mencionada en ESTE mensaje (el
  // cliente puede estar cambiándola) y, si no, la ya conocida de la sesión.
  const fechaEnTexto = (() => { const f = parseFecha(texto); return f && f >= hoyISO() ? f : undefined })()
  const preFecha = fechaEnTexto ?? datos.fecha
  const slotsPre = preFecha ? await slotsDisponiblesReserva(ctx.client_id, preFecha) : []
  const dispTexto = preFecha
    ? (slotsPre.length ? `${formatFechaStr(preFecha)}: ${slotsPre.map(s => formatHora(s.hora)).join(', ')}` : `${formatFechaStr(preFecha)}: sin horas libres`)
    : null

  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  const cartaUrl = tieneCarta(ctx) && ctx.slug && base ? `${base}/${ctx.slug}/catalogo` : null

  const r = await conversarReserva({
    clientId: ctx.client_id,
    etiqueta: 'reserva',
    negocio: ctx.nombre_empresa,
    horariosTexto: await horariosResumen(ctx.client_id),
    disponibilidadTexto: dispTexto,
    cartaUrl,
    pideNombre: !!(datos.fecha && datos.hora && datos.personas),
    datos: { fecha: datos.fecha, hora: datos.hora, personas: datos.personas, nombre: datos.nombre },
    historial: hist,
    mensaje: texto,
  })
  if (!r) return null

  // Fusionar lo que la IA haya extraído (validado).
  if (r.fecha && r.fecha >= hoyISO()) {
    if (r.fecha !== datos.fecha) { datos.hora = undefined; datos.franja_id = undefined } // cambió el día → invalidar la hora
    datos.fecha = r.fecha
  }
  if (r.personas) datos.personas = r.personas
  if (r.nombre) datos.nombre = r.nombre

  // La hora solo vale si es un hueco REAL del día elegido (no la IA inventando).
  if (r.hora && datos.fecha) {
    const slotsFecha = datos.fecha === preFecha ? slotsPre : await slotsDisponiblesReserva(ctx.client_id, datos.fecha)
    const match = slotsFecha.find(s => formatHora(s.hora) === r.hora)
    if (match) { datos.hora = formatHora(match.hora); datos.franja_id = match.franja_id; datos.franja_nombre = match.franja_nombre }
  }

  // ¿Completo? → resumen + botón (reutiliza la creación por RPC del paso confirmar).
  if (datos.fecha && datos.hora && datos.franja_id && datos.personas && datos.nombre) {
    return resumenConfirmacion(ctx, chatId, datos)
  }

  // Seguir conversando: guardamos estado + historial corto y devolvemos texto natural.
  hist.push({ rol: 'user', texto }, { rol: 'assistant', texto: r.respuesta })
  datos._hist = hist.slice(-6)
  await guardarSesion(ctx.client_id, chatId, 'ia', datos)
  return { texto: r.respuesta }
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
  const datos = { ...sesion.datos }

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
    return resumenConfirmacion(ctx, chatId, datos)
  }

  // ── CONFIRMAR ───────────────────────────────────────────────────────────────
  if (paso === 'confirmar') {
    if (texto !== 'confirmar_reserva') {
      return { texto: 'Usa el botón Confirmar o Cancelar.' }
    }

    const { data: cliente } = await db.from('clients')
      .select('bot_config, nombre_empresa')
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
      return { texto: `❌ No se pudo crear la reserva.\n\n${rpcErr.message}`, markup: tecladoPrincipal(ctx) }
    }

    const result = (rpcData as { ok?: boolean; error?: string; reserva_id?: string }) ?? {}
    if (!result.ok) {
      return { texto: `❌ ${result.error ?? 'Error al crear la reserva.'}`, markup: tecladoPrincipal(ctx) }
    }

    // Guardar el chat del cliente para poder avisarle de cambios de estado
    await db.from('reservas')
      .update({ telegram_chat_id: chatId })
      .eq('reserva_id', reservaId)
      .eq('client_id', ctx.client_id)

    // Avisar al dueño de la reserva nueva (con botones Confirmar/Rechazar si está pendiente)
    await notificarReservaNueva(
      {
        token:  ctx.token,
        activo: true,
        notificar_owner_chat_id: typeof botCfg.notificar_owner_chat_id === 'string' ? botCfg.notificar_owner_chat_id : null,
      },
      {
        reserva_id:       reservaId,
        fecha:            datos.fecha!,
        hora:             datos.hora!,
        personas:         datos.personas!,
        nombre_cliente:   datos.nombre!,
        telefono:         null,
        notas:            null,
        estado:           confirmAuto ? 'CONFIRMADA' : 'PENDIENTE',
        telegram_chat_id: chatId,
      },
      (cliente?.nombre_empresa as string) ?? ctx.nombre_empresa,
    )

    const estado = confirmAuto ? 'confirmada' : 'pendiente de confirmación'
    return {
      texto: `✅ ¡Reserva ${estado}!\n\n📅 ${formatFechaStr(datos.fecha!)}\n🕐 ${formatHora(datos.hora!)}\n👥 ${datos.personas} persona${datos.personas !== 1 ? 's' : ''}\n✏️ ${datos.nombre}\n\nTe avisaremos por aquí.`,
      markup: tecladoPrincipal(ctx),
    }
  }

  return { texto: 'Algo salió mal. Usa /start para volver.', markup: tecladoPrincipal(ctx) }
}

// ── Mostrar carta (solo si el negocio tiene el módulo de menú digital) ─────────

function tieneCarta(ctx: BotContext): boolean {
  return tieneModulo(ctx.modulos, 'catalogo_qr')
}

function mostrarCarta(ctx: BotContext): BotResponse {
  if (!tieneCarta(ctx) || !ctx.slug) {
    return { texto: 'La carta no está disponible ahora mismo.', markup: tecladoPrincipal(ctx) }
  }
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  const url = base ? `${base}/${ctx.slug}/catalogo` : `/${ctx.slug}/catalogo`
  return { texto: `📋 Nuestra carta:\n${url}`, markup: tecladoPrincipal(ctx) }
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
    return { texto: 'Horario no disponible todavía.', markup: tecladoPrincipal(ctx) }
  }

  const lista = (franjas as { nombre: string; hora_inicio: string | null; hora_fin: string | null }[])
    .map(f => `• ${f.nombre}: ${f.hora_inicio?.substring(0, 5) ?? '—'} – ${f.hora_fin?.substring(0, 5) ?? '—'}`)
    .join('\n')

  return { texto: `🕐 Horarios de ${ctx.nombre_empresa}\n\n${lista}`, markup: tecladoPrincipal(ctx) }
}

// ── Ayuda ─────────────────────────────────────────────────────────────────────

function mostrarAyuda(ctx: BotContext): BotResponse {
  const puede = ['• Hacer una reserva']
  if (tieneCarta(ctx)) puede.push('• Ver la carta')
  puede.push('• Consultar horarios')
  return {
    texto: `Bot de ${ctx.nombre_empresa}\n\nPuedes:\n${puede.join('\n')}`,
    markup: tecladoPrincipal(ctx),
  }
}

// ── Teclados ──────────────────────────────────────────────────────────────────

// En modo IA no se muestra ningún teclado (experiencia 100% conversacional; el
// único botón es el ✅ Confirmar del resumen). Sin IA: teclado clásico, con el
// botón «Carta» solo si el negocio tiene menú digital (catalogo_qr). «Ubicación»
// se retira hasta que exista dónde configurarla.
function tecladoPrincipal(ctx: BotContext): ReplyMarkup | undefined {
  if (ctx.iaActiva) return undefined
  const fila1 = [{ text: '📅 Reservar', callback_data: 'reservar' }]
  if (tieneCarta(ctx)) fila1.push({ text: '📋 Carta', callback_data: 'carta' })
  return {
    inline_keyboard: [
      fila1,
      [{ text: '🕐 Horarios', callback_data: 'horarios' }],
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
