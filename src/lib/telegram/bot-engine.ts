// ── Motor de bot de Telegram (agnóstico de canal) ──
// Por defecto, flujo de botones determinista. Si el negocio tiene el addon de IA
// y el dueño la activa (bot_config.ia_activa), el bot atiende en lenguaje natural
// (manejarConversacionReserva): la IA conversa y extrae datos, pero la reserva se
// crea SIEMPRE por RPC al pulsar el botón de confirmar (la IA nunca la crea).

import { createAdminClient } from '@/lib/supabase/admin'
import { hoyEnTz, ahoraEnTz, sumarDias } from '@/lib/fecha-tz'
import { notificarReservaNueva } from '@/lib/reservas/estado'
import { notificarReservaEntrante, notificarCancelacionCliente } from '@/lib/notificaciones/eventos'
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
// El flujo de botones va PERSONAS → DÍA → HORA. Antes preguntaba la hora antes que
// las personas, y como el aforo depende de las personas, el bot no podía saber si el
// hueco cabía: paseaba al cliente por cinco pasos para soltarle al final «No hay
// capacidad suficiente para esa hora». Es además el orden de la mini-web.
export type PasoReserva =
  | 'inicio' | 'personas' | 'personas_texto' | 'fecha' | 'hora' | 'telefono' | 'nombre' | 'confirmar' | 'ia'

export interface DatosReserva {
  fecha?: string
  franja_id?: string
  franja_nombre?: string
  hora?: string
  personas?: number
  nombre?: string
  telefono?: string
  // Solo en modo IA: historial corto de la conversación, para coherencia entre
  // turnos. Se descarta al pasar a 'confirmar'; la creación por RPC no lo usa.
  _hist?: TurnoConv[]
}

export interface SesionInfo {
  paso: PasoReserva | null
  datos: DatosReserva
}

/**
 * Una sesión a medias caduca a las 2 h (TG-20).
 *
 * Vivían 24 h: si el flujo quedaba parado en el paso «nombre» y el cliente volvía al
 * día siguiente y escribía «hola», eso pasaba a ser el NOMBRE de la reserva. Dos horas
 * es más tiempo del que nadie tarda en reservar una mesa, y menos del que hace falta
 * para olvidarse de que estaba a medias.
 */
const SESION_VIVA_MS = 2 * 60 * 60 * 1000

export async function cargarSesion(clientId: string, chatId: string): Promise<SesionInfo> {
  const db = createAdminClient()
  const { data } = await db.from('telegram_sessions')
    .select('paso, datos, updated_at')
    .eq('client_id', clientId)
    .eq('chat_id', chatId)
    .eq('modulo', 'reservas')
    .maybeSingle()

  const visto = data?.updated_at ? Date.parse(data.updated_at as string) : 0
  if (visto && Date.now() - visto > SESION_VIVA_MS) return { paso: null, datos: {} }

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
      await guardarSesion(ctx.client_id, chat_id, 'personas', {})
      return promptPersonas()
    }
    return manejarPasoReserva(ctx, chat_id, sesion, texto.trim())
  }

  if (t === '/start' || SALUDOS.some(s => t.startsWith(s))) return bienvenida(ctx)
  if (t === 'reservar' || t === '/reservar') return iniciarReserva(ctx, chat_id)
  if (t === 'cancelar_flujo') return bienvenida(ctx)
  if (t === 'mis_reservas' || t === '/mis_reservas') return misReservas(ctx, chat_id)
  if (t.startsWith('cancelar_res:')) return cancelarDesdeBot(ctx, chat_id, t.replace('cancelar_res:', ''))
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
    texto: `¡Hola! Soy el asistente de ${ctx.nombre_empresa}. ¿Te ayudo con una reserva? Dime el día, la hora y para cuántas personas y te lo preparo.${carta}`,
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
  await guardarSesion(ctx.client_id, chatId, 'personas', {})
  return promptPersonas()
}

// Cada paso anuncia su salida: sin esto, una sesión a medias convertía cualquier
// cosa que escribiera el cliente en el nombre de la reserva (TG-20).
const SALIDA = '\n\nEscribe *cancelar* para empezar de nuevo.'.replace(/\*/g, '')

function promptPersonas(): BotResponse {
  return {
    texto: `¿Para cuántas personas?${SALIDA}`,
    markup: {
      inline_keyboard: [
        [{ text: '1', callback_data: 'personas:1' }, { text: '2', callback_data: 'personas:2' }, { text: '3', callback_data: 'personas:3' }],
        [{ text: '4', callback_data: 'personas:4' }, { text: '5', callback_data: 'personas:5' }, { text: '6 o más', callback_data: 'personas:mas' }],
        [{ text: 'Cancelar', callback_data: 'cancelar_flujo' }],
      ],
    },
  }
}

/**
 * Elegir día con los días que DE VERDAD tienen hueco (TG-22).
 *
 * Antes eran «Hoy / Mañana / Otro día», y «Otro día» obliga a escribir una fecha a
 * mano en el móvil — que es exactamente donde se cae la gente. Los días salen de
 * `res_dias_disponibles_aforo`, que ya existe y ya mira aforo, cierres y reglas.
 */
async function promptDias(ctx: BotContext, chatId: string, datos: DatosReserva): Promise<BotResponse> {
  const dias = await diasConHueco(ctx.client_id, datos.personas ?? 1)
  const filas: { text: string; callback_data: string }[][] = []
  for (let i = 0; i < Math.min(dias.length, 8); i++) {
    if (i % 2 === 0) filas.push([])
    const d = dias[i]
    filas[filas.length - 1].push({ text: etiquetaDia(d.fecha), callback_data: `fecha:${d.fecha}` })
  }
  filas.push([{ text: 'Otro día', callback_data: 'fecha:otro' }])
  filas.push([{ text: '← Volver', callback_data: 'reservar' }, { text: 'Cancelar', callback_data: 'cancelar_flujo' }])

  await guardarSesion(ctx.client_id, chatId, 'inicio', datos)

  const cabecera = dias.length === 0
    ? `No veo huecos para ${datos.personas} en los próximos días. Puedes probar otra fecha o escribirnos.`
    : `Para ${datos.personas} persona${datos.personas === 1 ? '' : 's'}. ¿Qué día?`
  return { texto: `${cabecera}${SALIDA}`, markup: { inline_keyboard: filas } }
}

function etiquetaDia(f: string): string {
  if (f === hoyISO()) return 'Hoy'
  if (f === sumarDias(hoyISO(), 1)) return 'Mañana'
  const [y, m, d] = f.split('-').map(Number)
  const dow = new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')
  return `${dow} ${d}`
}

// ── Helper: calcular slots horarios libres de un día (reutilizado por botones e IA) ──

export interface SlotReserva { hora: string; franja_id: string; franja_nombre: string }

/**
 * Huecos libres de un día. **Una sola fuente de verdad: `res_slots_aforo`** (TG-7).
 *
 * Esto enumeraba huecos de 30 min dentro de las franjas y solo descartaba días de la
 * semana y horas pasadas: no miraba aforo, ni cierres, ni antelación, ni ventana. La
 * mini-web sí, porque usa la RPC. Resultado: el bot paseaba al cliente por cinco pasos
 * para soltarle al final «No hay capacidad suficiente para esa hora».
 *
 * El aforo depende de las PERSONAS, por eso son un parámetro y por eso el flujo las
 * pregunta primero.
 */
export async function slotsDisponiblesReserva(
  clientId: string, fecha: string, personas = 1,
): Promise<SlotReserva[]> {
  const db = createAdminClient()
  const { data, error } = await db.rpc('res_slots_aforo', {
    p_client_id: clientId, p_fecha: fecha, p_personas: personas < 1 ? 1 : personas,
  })
  if (error || !Array.isArray(data)) return []

  const libres = (data as { hora: string; franja_id: string; libre: boolean }[]).filter(s => s.libre)
  if (libres.length === 0) return []

  // El nombre del turno solo se enseña si el negocio tiene más de uno: con uno solo
  // («Comidas») es ruido, con dos («Terraza» / «Salón») es justo lo que hay que elegir.
  const { data: franjas } = await db.from('reserva_franjas')
    .select('franja_id, nombre').eq('client_id', clientId).eq('activa', true)
  const lista = (franjas ?? []) as { franja_id: string; nombre: string }[]
  const nombres = new Map(lista.map(f => [f.franja_id, f.nombre]))
  const varios = lista.length > 1

  return libres.map(s => ({
    hora: s.hora,
    franja_id: s.franja_id,
    franja_nombre: varios ? (nombres.get(s.franja_id) ?? '') : '',
  }))
}

/** Tope de personas por reserva del negocio (`reserva_max_personas`). 0 = sin tope. */
async function topePersonas(clientId: string): Promise<number> {
  const db = createAdminClient()
  const { data } = await db.from('clients')
    .select('reserva_max_personas').eq('client_id', clientId).maybeSingle()
  return Number(data?.reserva_max_personas ?? 0) || 0
}

/** Próximos días con hueco REAL para ese número de personas (TG-22). */
async function diasConHueco(clientId: string, personas: number): Promise<{ fecha: string; primera_hora: string }[]> {
  const db = createAdminClient()
  const { data, error } = await db.rpc('res_dias_disponibles_aforo', {
    p_client_id: clientId, p_personas: personas < 1 ? 1 : personas,
    p_desde: hoyISO(), p_max_dias: 30,
  })
  if (error || !Array.isArray(data)) return []
  return data as { fecha: string; primera_hora: string }[]
}

// ── Helper: mostrar slots horarios disponibles (flujo de botones) ──────────────

async function mostrarSlots(ctx: BotContext, chatId: string, datos: DatosReserva): Promise<BotResponse> {
  const fecha = datos.fecha!
  const slots = await slotsDisponiblesReserva(ctx.client_id, fecha, datos.personas ?? 1)

  // TG-18: un día sin huecos BORRABA la sesión y devolvía al teclado inicial, así que
  // probar otro día era empezar de cero. Se deja al cliente en el paso del día, con
  // sus datos puestos — que es lo que ya hace bien el motor de Citas.
  if (slots.length === 0) {
    const r = await promptDias(ctx, chatId, datos)
    return { texto: `Ese día no me queda hueco para ${datos.personas}. ${r.texto}`, markup: r.markup }
  }

  const botones: { text: string; callback_data: string }[][] = []
  for (let i = 0; i < Math.min(slots.length, 24); i++) {
    if (i % 3 === 0) botones.push([])
    const s = slots[i]
    botones[botones.length - 1].push({
      // Con más de un turno, la hora sola no dice si es Terraza o Salón.
      text: s.franja_nombre ? `${formatHora(s.hora)} ${s.franja_nombre}` : formatHora(s.hora),
      callback_data: `slot:${s.franja_id}:${s.hora}`,
    })
  }
  botones.push([{ text: '← Otro día', callback_data: 'reservar_dia' }, { text: 'Cancelar', callback_data: 'cancelar_flujo' }])

  await guardarSesion(ctx.client_id, chatId, 'hora', datos)
  return {
    texto: `📅 ${formatFechaStr(fecha)} · ${datos.personas} persona${datos.personas === 1 ? '' : 's'}\n\nElige una hora:${SALIDA}`,
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
    hora: datos.hora, personas: datos.personas, nombre: datos.nombre, telefono: datos.telefono,
  }
  await guardarSesion(ctx.client_id, chatId, 'confirmar', limpio)

  const autoText = confirmAuto ? '\n✅ Confirmación automática: tu reserva se confirma al instante.' : '\nTe confirmaremos por este mismo chat.'
  return {
    // TG-10: iba `*Resumen*` y `enviarMensaje` nunca manda `parse_mode`, así que el
    // cliente leía literalmente los asteriscos. Se quitan (más simple que meter
    // Markdown y tener que escapar el texto libre que escribe el cliente).
    texto: `📋 Resumen\n\n📅 ${formatFechaStr(datos.fecha!)}\n🕐 ${formatHora(datos.hora!)}\n👥 ${datos.personas} persona${datos.personas !== 1 ? 's' : ''}\n✏️ ${datos.nombre}${datos.telefono ? `\n📞 ${datos.telefono}` : ''}${autoText}\n\n¿Confirmar reserva?`,
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

  // ── PERSONAS (primer paso: de ellas depende el aforo) ───────────────────────
  if (paso === 'personas') {
    // TG-8: «6+» mandaba `personas:6` y ahí moría — justo la reserva que más importa
    // a un restaurante. Ahora pide el número.
    if (texto === 'personas:mas') {
      await guardarSesion(ctx.client_id, chatId, 'personas_texto', datos)
      const tope = await topePersonas(ctx.client_id)
      return { texto: `¿Cuántas personas sois?${tope ? ` (máximo ${tope})` : ''}${SALIDA}` }
    }
    const n = parseInt(texto.replace('personas:', ''), 10)
    if (isNaN(n) || n < 1) return promptPersonas()
    datos.personas = n
    return promptDias(ctx, chatId, datos)
  }

  if (paso === 'personas_texto') {
    const n = parseInt(texto.replace(/\D/g, ''), 10)
    const tope = await topePersonas(ctx.client_id)
    if (isNaN(n) || n < 1) return { texto: `Dime un número, por favor.${SALIDA}` }
    if (tope > 0 && n > tope) {
      return { texto: `Para grupos de más de ${tope} personas, escríbenos y lo organizamos.${SALIDA}` }
    }
    datos.personas = n
    return promptDias(ctx, chatId, datos)
  }

  // ── DÍA ─────────────────────────────────────────────────────────────────────
  if (paso === 'inicio') {
    if (texto === 'fecha:otro') {
      await guardarSesion(ctx.client_id, chatId, 'fecha', datos)
      return { texto: `Escribe la fecha (ej: 25/06 o 2026-06-25):${SALIDA}` }
    }
    if (texto.startsWith('fecha:')) {
      const tag = texto.replace('fecha:', '')
      // El botón trae la fecha ya resuelta por el servidor; «hoy»/«mañana» se
      // mantienen por si llegan escritas (TG-11: nunca con `toISOString`, que en
      // Cuba después de las 20:00 da el día siguiente).
      if (tag === 'hoy')          datos.fecha = hoyISO()
      else if (tag === 'mañana')  datos.fecha = sumarDias(hoyISO(), 1)
      else if (/^\d{4}-\d{2}-\d{2}$/.test(tag)) datos.fecha = tag
    } else {
      const pf = parseFecha(texto)
      if (!pf) return { texto: `No entiendo esa fecha. Escribe DD/MM o YYYY-MM-DD.${SALIDA}`, markup: tecladoFecha() }
      if (pf < hoyISO()) return { texto: `Esa fecha ya pasó. Elige una fecha futura.${SALIDA}`, markup: tecladoFecha() }
      datos.fecha = pf
    }
    if (!datos.fecha) return promptDias(ctx, chatId, datos)

    return mostrarSlots(ctx, chatId, datos)
  }

  // ── FECHA (texto libre) ─────────────────────────────────────────────────────
  if (paso === 'fecha') {
    const pf = parseFecha(texto)
    if (!pf) return { texto: `No entiendo esa fecha. Escribe DD/MM o YYYY-MM-DD.${SALIDA}`, markup: tecladoFecha() }
    if (pf < hoyISO()) return { texto: `Esa fecha ya pasó. Elige una fecha futura.${SALIDA}`, markup: tecladoFecha() }
    datos.fecha = pf
    return mostrarSlots(ctx, chatId, datos)
  }

  // ── HORA ────────────────────────────────────────────────────────────────────
  if (paso === 'hora') {
    if (texto === 'reservar_dia') return promptDias(ctx, chatId, datos)
    if (!texto.startsWith('slot:')) {
      return { texto: `Elige una hora de los botones.${SALIDA}` }
    }
    const parts = texto.replace('slot:', '').split(':')
    // Formato: FRANJA_ID:HH:MM (la FRANJA_ID no contiene ':')
    datos.franja_id = parts[0]
    datos.hora = parts.slice(1).join(':')
    datos.franja_nombre = ''

    await guardarSesion(ctx.client_id, chatId, 'nombre', datos)
    return { texto: `¿A nombre de quién?${SALIDA}` }
  }

  // ── NOMBRE ──────────────────────────────────────────────────────────────────
  if (paso === 'nombre') {
    if (texto.length < 2) return { texto: `El nombre debe tener al menos 2 letras.${SALIDA}` }
    datos.nombre = texto
    // TG-9: el bot nunca pedía teléfono (`p_telefono: null`) y la web lo exige. El
    // chat identifica al cliente, pero el dueño necesita poder llamarle.
    await guardarSesion(ctx.client_id, chatId, 'telefono', datos)
    return {
      texto: `¿Un teléfono de contacto?${SALIDA}`,
      markup: { inline_keyboard: [[{ text: 'Saltar', callback_data: 'tel:saltar' }]] },
    }
  }

  // ── TELÉFONO (opcional) ─────────────────────────────────────────────────────
  if (paso === 'telefono') {
    if (texto !== 'tel:saltar') {
      const tel = texto.trim()
      if (tel.replace(/\D/g, '').length < 6) {
        return {
          texto: `Ese teléfono no parece válido. Escríbelo de nuevo o pulsa Saltar.${SALIDA}`,
          markup: { inline_keyboard: [[{ text: 'Saltar', callback_data: 'tel:saltar' }]] },
        }
      }
      datos.telefono = tel
    }
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
      p_telefono:                datos.telefono ?? null,
      p_notas:                   null,
      p_canal:                   'bot',
      p_confirmacion_automatica: confirmAuto,
      p_reserva_id:              reservaId,
    })

    // TG-19: un error aquí borraba la sesión y tiraba TODO el flujo — el cliente
    // tenía que volver a empezar por las personas. Ahora vuelve al paso de la hora
    // con su día puesto, y el mensaje dice qué pasó.
    if (rpcErr) {
      const r = await mostrarSlots(ctx, chatId, datos)
      return { texto: `No se pudo crear la reserva. ${r.texto}`, markup: r.markup }
    }

    const result = (rpcData as { ok?: boolean; error?: string; reserva_id?: string }) ?? {}
    if (!result.ok) {
      const r = await mostrarSlots(ctx, chatId, datos)
      return { texto: `${result.error ?? 'No se pudo crear la reserva.'} ${r.texto}`, markup: r.markup }
    }

    await guardarSesion(ctx.client_id, chatId, null, {})

    // Guardar el chat del cliente para poder avisarle de cambios de estado
    const { data: guardada } = await db.from('reservas')
      .update({ telegram_chat_id: chatId })
      .eq('reserva_id', reservaId)
      .eq('client_id', ctx.client_id)
      .select('token')
      .maybeSingle()

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
        telefono:         datos.telefono ?? null,
        notas:            null,
        estado:           confirmAuto ? 'CONFIRMADA' : 'PENDIENTE',
        telegram_chat_id: chatId,
      },
      (cliente?.nombre_empresa as string) ?? ctx.nombre_empresa,
    )

    // Bandeja interna del portal: el dueño la ve aunque no mire Telegram.
    await notificarReservaEntrante({
      clientId: ctx.client_id, reservaId, modo: 'reserva',
      nombreCliente: datos.nombre!, fecha: datos.fecha!, hora: datos.hora!,
      detalle: `${datos.personas} persona${datos.personas === 1 ? '' : 's'}`,
      pendiente: !confirmAuto,
    })

    const estado = confirmAuto ? 'confirmada' : 'pendiente de confirmación'
    // TG-14: el enlace de gestión existía y no se usaba en ningún sitio. Es lo que
    // permite al cliente cancelar solo — o sea, la mitad del anti-no-show.
    const base = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
    const enlace = guardada?.token && ctx.slug && base
      ? `\n\nPara verla o cancelarla:\n${base}/${ctx.slug}/r/${guardada.token}`
      : ''
    return {
      texto: `✅ ¡Reserva ${estado}!\n\n📅 ${formatFechaStr(datos.fecha!)}\n🕐 ${formatHora(datos.hora!)}\n👥 ${datos.personas} persona${datos.personas !== 1 ? 's' : ''}\n✏️ ${datos.nombre}\n\nTe avisaremos por aquí.${enlace}`,
      markup: tecladoPrincipal(ctx),
    }
  }

  return { texto: 'Algo salió mal. Usa /start para volver.', markup: tecladoPrincipal(ctx) }
}

// ── Mis reservas (TG-23) ──────────────────────────────────────────────────────
//
// El cliente que reservó por el bot no tenía forma de ver ni cancelar lo suyo desde
// el bot: solo con el enlace de la pantalla de éxito, que se pierde al cerrar el chat.
// Y una cancelación a tiempo es media reserva recuperada.

async function misReservas(ctx: BotContext, chatId: string): Promise<BotResponse> {
  const db = createAdminClient()
  const { data } = await db.from('reservas')
    .select('reserva_id, fecha, hora, personas, estado')
    .eq('client_id', ctx.client_id)
    .eq('telegram_chat_id', chatId)
    .is('recurso_id', null)
    .gte('fecha', hoyISO())
    .in('estado', ['PENDIENTE', 'CONFIRMADA'])
    .order('fecha').order('hora')
    .limit(5)

  const lista = (data ?? []) as { reserva_id: string; fecha: string; hora: string | null; personas: number; estado: string }[]
  if (lista.length === 0) {
    return { texto: 'No tienes reservas próximas por aquí.', markup: tecladoPrincipal(ctx) }
  }

  const filas = lista.map(r => ([{
    text: `✕ Cancelar ${formatFechaStr(r.fecha)} ${formatHora(r.hora ?? '')}`,
    callback_data: `cancelar_res:${r.reserva_id}`,
  }]))

  const texto = lista.map(r =>
    `📅 ${formatFechaStr(r.fecha)}  🕐 ${formatHora(r.hora ?? '')}  👥 ${r.personas}` +
    `  ·  ${r.estado === 'CONFIRMADA' ? 'confirmada' : 'pendiente'}`).join('\n')

  return { texto: `Tus próximas reservas:\n\n${texto}`, markup: { inline_keyboard: filas } }
}

async function cancelarDesdeBot(ctx: BotContext, chatId: string, reservaId: string): Promise<BotResponse> {
  const db = createAdminClient()
  // El `telegram_chat_id` es el candado: solo puede cancelar quien reservó por ESTE
  // chat. El id de la reserva viaja en el botón, o sea por el navegador del cliente.
  const { data: reserva } = await db.from('reservas')
    .select('reserva_id, estado, fecha')
    .eq('reserva_id', reservaId)
    .eq('client_id', ctx.client_id)
    .eq('telegram_chat_id', chatId)
    .maybeSingle()

  if (!reserva) return { texto: 'No encuentro esa reserva.', markup: tecladoPrincipal(ctx) }
  if (!['PENDIENTE', 'CONFIRMADA'].includes(reserva.estado as string)) {
    return { texto: 'Esa reserva ya no está activa.', markup: tecladoPrincipal(ctx) }
  }

  const { error } = await db.from('reservas')
    .update({ estado: 'CANCELADA', updated_at: new Date().toISOString() })
    .eq('reserva_id', reservaId).eq('client_id', ctx.client_id)
  if (error) return { texto: 'No se pudo cancelar. Inténtalo en un momento.', markup: tecladoPrincipal(ctx) }

  // Que el dueño se entere: es el hueco que acaba de liberarse.
  await notificarCancelacionCliente({
    clientId: ctx.client_id, reservaId, modo: 'reserva',
    nombreCliente: '', fecha: reserva.fecha as string, hora: '',
  }).catch(() => { /* la cancelación ya está hecha; el aviso es secundario */ })

  return { texto: '✅ Reserva cancelada. Gracias por avisar.', markup: tecladoPrincipal(ctx) }
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
  const puede = ['• Hacer una reserva', '• Ver o cancelar tus reservas']
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
      // TG-23: el bot es el ÚNICO canal donde el cliente está identificado, y hasta
      // ahora no podía ver ni cancelar lo suyo desde aquí.
      [{ text: '🗒 Mis reservas', callback_data: 'mis_reservas' }, { text: '🕐 Horarios', callback_data: 'horarios' }],
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
