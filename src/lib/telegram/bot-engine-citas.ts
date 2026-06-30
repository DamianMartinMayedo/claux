// ── Motor de bot de Telegram para CITAS (agenda) ──
// Flujo conversacional de pedir cita: servicio → profesional → fecha → hora →
// nombre → confirmar. Independiente del de Reservas (aforo). Reutiliza la tabla
// `reservas`, los RPC `res_slots_cita`/`res_crear_cita` y las notificaciones.

import { createAdminClient } from '@/lib/supabase/admin'
import { hoyEnTz, sumarDias } from '@/lib/fecha-tz'
import { notificarReservaNueva } from '@/lib/reservas/estado'
import { parseBotConfig } from '@/lib/reservas/bot-config'
import { etiquetasDe, ETIQUETAS_DEFAULT, type EtiquetasSector } from '@/lib/sector'
import { tieneModulo } from '@/lib/modulos'
import { interpretarMensajeBot } from '@/lib/ia/telegram'
import { type BotContext, type BotResponse, parseFecha, formatFechaStr, formatHora } from './bot-engine'

// ── Sesión (clave por modulo='citas') ──────────────────────────────────────────

type PasoCita = 'servicio' | 'recurso' | 'fecha' | 'hora' | 'nombre' | 'confirmar'

interface DatosCita {
  servicio_id?:     string
  servicio_nombre?: string
  recurso_id?:      string   // '' = cualquiera (se concreta al elegir hueco)
  recurso_nombre?:  string
  fecha?:           string
  hora?:            string
  nombre?:          string
}

interface SesionCita {
  paso:  PasoCita | null
  datos: DatosCita
}

async function cargarSesion(clientId: string, chatId: string): Promise<SesionCita> {
  const db = createAdminClient()
  const { data } = await db.from('telegram_sessions')
    .select('paso, datos')
    .eq('client_id', clientId).eq('chat_id', chatId).eq('modulo', 'citas')
    .maybeSingle()
  return { paso: (data?.paso as PasoCita) ?? null, datos: (data?.datos as DatosCita) ?? {} }
}

async function guardarSesion(clientId: string, chatId: string, paso: PasoCita | null, datos: DatosCita) {
  const db = createAdminClient()
  await db.from('telegram_sessions')
    .upsert({ client_id: clientId, chat_id: chatId, modulo: 'citas', paso, datos, updated_at: new Date().toISOString() },
            { onConflict: 'client_id,chat_id,modulo' })
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const SALUDOS = ['hola', 'buenas', 'buenos días', 'buenas tardes', 'buenas noches', 'saludos', 'hey', 'ola']
function hoyISO(): string { return hoyEnTz() }

async function etiquetasCitas(clientId: string): Promise<EtiquetasSector> {
  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('sector').eq('client_id', clientId).maybeSingle()
  if (!cli?.sector) return { ...ETIQUETAS_DEFAULT }
  const { data: pl } = await db.from('plantillas_sector').select('etiquetas').eq('sector', cli.sector).maybeSingle()
  return etiquetasDe(pl?.etiquetas)
}

interface ServicioRow { servicio_id: string; nombre: string; duracion_minutos: number; precio: number | null }
interface RecursoRow  { recurso_id: string; nombre: string }
interface SlotRow     { recurso_id: string; recurso_nombre: string; hora: string }

// ── Entrada principal ───────────────────────────────────────────────────────────

export async function manejarMensajeCitas(ctx: BotContext, texto: string, chat_id: string): Promise<BotResponse> {
  const t = texto.trim().toLowerCase()

  const sesion = await cargarSesion(ctx.client_id, chat_id)
  if (sesion.paso) {
    if (t === 'cancelar_cita' || t === 'cancelar' || t === '/cancelar') {
      await guardarSesion(ctx.client_id, chat_id, null, {})
      return bienvenida(ctx)
    }
    if (t === 'pedir_cita') return iniciarCita(ctx, chat_id)
    return manejarPasoCita(ctx, chat_id, sesion, texto.trim())
  }

  if (t === '/start' || SALUDOS.some(s => t.startsWith(s))) return bienvenida(ctx)
  if (t === 'pedir_cita' || t === 'cita' || t === '/cita' || t === 'reservar' || t === '/reservar') {
    return iniciarCita(ctx, chat_id)
  }
  if (t === 'ayuda' || t === 'help') return mostrarAyuda(ctx)

  // Capa de IA opcional (add-on): interpreta lenguaje libre antes del teclado.
  const ia = await intentarIaCitas(ctx, chat_id, texto.trim())
  if (ia) return ia

  return { texto: `Hola, soy el bot de ${ctx.nombre_empresa}. ¿Quieres pedir una cita?`, markup: tecladoPrincipal() }
}

// Si el negocio tiene el addon de IA, deja que interprete el lenguaje natural y
// arranque el flujo de cita. Devuelve null si no hay addon o nada accionable.
async function intentarIaCitas(ctx: BotContext, chatId: string, texto: string): Promise<BotResponse | null> {
  const db = createAdminClient()
  const { data: cliente } = await db.from('clients').select('modulos_activos').eq('client_id', ctx.client_id).single()
  if (!tieneModulo(cliente?.modulos_activos, 'asistente_ia')) return null

  const intent = await interpretarMensajeBot(ctx.client_id, 'cita', texto)
  if (!intent || intent.intent !== 'reservar') return null
  // La cita necesita elegir servicio primero: arrancamos el flujo conversacional.
  return iniciarCita(ctx, chatId)
}

// ── Bienvenida / teclado ────────────────────────────────────────────────────────

function bienvenida(ctx: BotContext): BotResponse {
  return { texto: `¡Bienvenido a ${ctx.nombre_empresa}!\n\n¿Qué quieres hacer?`, markup: tecladoPrincipal() }
}
function tecladoPrincipal() {
  return { inline_keyboard: [[{ text: '📅 Pedir cita', callback_data: 'pedir_cita' }]] }
}
function mostrarAyuda(ctx: BotContext): BotResponse {
  return { texto: `Bot de ${ctx.nombre_empresa}\n\nPuedes pedir una cita pulsando «Pedir cita».`, markup: tecladoPrincipal() }
}

// ── Paso 1: elegir servicio ──────────────────────────────────────────────────────

async function iniciarCita(ctx: BotContext, chatId: string): Promise<BotResponse> {
  const db = createAdminClient()
  const et = await etiquetasCitas(ctx.client_id)
  const { data: servicios } = await db.from('servicios')
    .select('servicio_id, nombre, duracion_minutos, precio')
    .eq('client_id', ctx.client_id).eq('activo', true).order('nombre')

  const lista = (servicios ?? []) as ServicioRow[]
  if (lista.length === 0) {
    await guardarSesion(ctx.client_id, chatId, null, {})
    return { texto: 'Todavía no hay servicios disponibles. Vuelve pronto.', markup: tecladoPrincipal() }
  }

  const botones = lista.slice(0, 30).map(s => [{
    text: `${s.nombre} (${s.duracion_minutos} min${s.precio != null ? ` · $${Number(s.precio).toFixed(2)}` : ''})`,
    callback_data: `csrv:${s.servicio_id}`,
  }])
  botones.push([{ text: 'Cancelar', callback_data: 'cancelar_cita' }])

  await guardarSesion(ctx.client_id, chatId, 'servicio', {})
  return { texto: `Elige un ${et.servicio.toLowerCase()}:`, markup: { inline_keyboard: botones } }
}

// ── Máquina de pasos ─────────────────────────────────────────────────────────────

async function manejarPasoCita(ctx: BotContext, chatId: string, sesion: SesionCita, texto: string): Promise<BotResponse> {
  const db = createAdminClient()
  const paso = sesion.paso!
  const datos = { ...sesion.datos }
  const et = await etiquetasCitas(ctx.client_id)

  // ── SERVICIO ──
  if (paso === 'servicio') {
    if (!texto.startsWith('csrv:')) return { texto: `Elige un ${et.servicio.toLowerCase()} de los botones.` }
    const servicioId = texto.slice('csrv:'.length)
    const { data: srv } = await db.from('servicios')
      .select('servicio_id, nombre').eq('servicio_id', servicioId).eq('client_id', ctx.client_id).eq('activo', true).maybeSingle()
    if (!srv) return { texto: 'Ese servicio ya no está disponible. Empieza de nuevo con «Pedir cita».', markup: tecladoPrincipal() }
    datos.servicio_id = srv.servicio_id
    datos.servicio_nombre = srv.nombre
    return promptRecurso(ctx, chatId, datos, et)
  }

  // ── RECURSO / PROFESIONAL ──
  if (paso === 'recurso') {
    if (!texto.startsWith('crec:')) return { texto: `Elige ${et.recurso.toLowerCase()} de los botones.` }
    const sel = texto.slice('crec:'.length)
    if (sel === 'any') { datos.recurso_id = ''; datos.recurso_nombre = `Cualquier ${et.recurso.toLowerCase()}` }
    else {
      const { data: rec } = await db.from('recursos')
        .select('recurso_id, nombre').eq('recurso_id', sel).eq('client_id', ctx.client_id).eq('activo', true).maybeSingle()
      if (!rec) return { texto: 'Esa opción ya no está disponible. Empieza de nuevo con «Pedir cita».', markup: tecladoPrincipal() }
      datos.recurso_id = rec.recurso_id; datos.recurso_nombre = rec.nombre
    }
    await guardarSesion(ctx.client_id, chatId, 'fecha', datos)
    return promptFecha()
  }

  // ── FECHA ──
  if (paso === 'fecha') {
    if (texto === 'cfecha:otro') return { texto: 'Escribe la fecha (ej: 25/06 o 2026-06-25):' }
    let fecha: string | null = null
    if (texto.startsWith('cfecha:')) {
      const tag = texto.slice('cfecha:'.length)
      if (tag === 'hoy') fecha = hoyISO()
      else if (tag === 'mañana') fecha = sumarDias(hoyISO(), 1)
    } else {
      fecha = parseFecha(texto)
    }
    if (!fecha) return { texto: 'No entiendo esa fecha. Escribe DD/MM o YYYY-MM-DD.', markup: tecladoFecha() }
    if (fecha < hoyISO()) return { texto: 'Esa fecha ya pasó. Elige una fecha futura.', markup: tecladoFecha() }
    datos.fecha = fecha
    return mostrarSlotsCita(ctx, chatId, datos)
  }

  // ── HORA ──
  if (paso === 'hora') {
    if (!texto.startsWith('cslot:')) return { texto: 'Elige una hora de los botones.' }
    // Formato: cslot:<recurso_id>:HH:MM — recurso_id no contiene ':'
    const rest = texto.slice('cslot:'.length)
    const firstColon = rest.indexOf(':')
    datos.recurso_id = rest.slice(0, firstColon)
    datos.hora = rest.slice(firstColon + 1)
    await guardarSesion(ctx.client_id, chatId, 'nombre', datos)
    return { texto: '¿A nombre de quién?' }
  }

  // ── NOMBRE ──
  if (paso === 'nombre') {
    if (texto.length < 2) return { texto: 'El nombre debe tener al menos 2 letras.' }
    datos.nombre = texto
    const { data: cli } = await db.from('clients').select('bot_config_citas').eq('client_id', ctx.client_id).single()
    const confirmAuto = parseBotConfig(cli?.bot_config_citas).confirmacion_automatica
    await guardarSesion(ctx.client_id, chatId, 'confirmar', datos)
    const autoText = confirmAuto ? '\n✅ Tu cita se confirma al instante.' : '\nTe confirmaremos por este mismo chat.'
    return {
      texto: `📋 Resumen\n\n💈 ${datos.servicio_nombre}\n👤 ${datos.recurso_nombre}\n📅 ${formatFechaStr(datos.fecha!)}\n🕐 ${formatHora(datos.hora!)}\n✏️ ${datos.nombre}${autoText}\n\n¿Confirmar cita?`,
      markup: { inline_keyboard: [[{ text: '✅ Confirmar', callback_data: 'confirmar_cita' }], [{ text: '← Cancelar', callback_data: 'cancelar_cita' }]] },
    }
  }

  // ── CONFIRMAR ──
  if (paso === 'confirmar') {
    if (texto !== 'confirmar_cita') return { texto: 'Usa el botón Confirmar o Cancelar.' }

    const { data: cli } = await db.from('clients').select('bot_config_citas, nombre_empresa').eq('client_id', ctx.client_id).single()
    const bot = parseBotConfig(cli?.bot_config_citas)
    const reservaId = `RES-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`

    const { data: rpcData, error: rpcErr } = await db.rpc('res_crear_cita', {
      p_client_id: ctx.client_id, p_recurso_id: datos.recurso_id!, p_servicio_id: datos.servicio_id!,
      p_fecha: datos.fecha!, p_hora: datos.hora! + ':00', p_nombre_cliente: datos.nombre!,
      p_telefono: null, p_notas: null, p_canal: 'bot',
      p_confirmacion_automatica: bot.confirmacion_automatica, p_reserva_id: reservaId,
    })

    await guardarSesion(ctx.client_id, chatId, null, {})

    if (rpcErr) return { texto: `❌ No se pudo crear la cita.\n\n${rpcErr.message}`, markup: tecladoPrincipal() }
    const result = (rpcData as { ok?: boolean; error?: string }) ?? {}
    if (!result.ok) return { texto: `❌ ${result.error ?? 'Error al crear la cita.'}`, markup: tecladoPrincipal() }

    // Guardar el chat del cliente para avisarle de cambios de estado
    await db.from('reservas').update({ telegram_chat_id: chatId }).eq('reserva_id', reservaId).eq('client_id', ctx.client_id)

    await notificarReservaNueva(
      { token: ctx.token, activo: true, notificar_owner_chat_id: bot.notificar_owner_chat_id },
      { reserva_id: reservaId, fecha: datos.fecha!, hora: datos.hora!, personas: 1,
        nombre_cliente: datos.nombre!, telefono: null, notas: datos.servicio_nombre ?? null,
        estado: bot.confirmacion_automatica ? 'CONFIRMADA' : 'PENDIENTE', telegram_chat_id: chatId },
      (cli?.nombre_empresa as string) ?? ctx.nombre_empresa,
    )

    const estado = bot.confirmacion_automatica ? 'confirmada' : 'pendiente de confirmación'
    return {
      texto: `✅ ¡Cita ${estado}!\n\n💈 ${datos.servicio_nombre}\n👤 ${datos.recurso_nombre}\n📅 ${formatFechaStr(datos.fecha!)}\n🕐 ${formatHora(datos.hora!)}\n✏️ ${datos.nombre}\n\nTe avisaremos por aquí.`,
      markup: tecladoPrincipal(),
    }
  }

  return { texto: 'Algo salió mal. Pulsa «Pedir cita» para empezar.', markup: tecladoPrincipal() }
}

// ── Prompts ──────────────────────────────────────────────────────────────────────

async function promptRecurso(ctx: BotContext, chatId: string, datos: DatosCita, et: EtiquetasSector): Promise<BotResponse> {
  const db = createAdminClient()
  const [{ data: recursos }, { data: links }] = await Promise.all([
    db.from('recursos').select('recurso_id, nombre').eq('client_id', ctx.client_id).eq('activo', true).order('nombre'),
    db.from('recurso_servicios').select('recurso_id, servicio_id'),
  ])

  const linkByRec = new Map<string, Set<string>>()
  for (const row of (links ?? []) as { recurso_id: string; servicio_id: string }[]) {
    const s = linkByRec.get(row.recurso_id) ?? new Set<string>()
    s.add(row.servicio_id); linkByRec.set(row.recurso_id, s)
  }
  // recurso sin asignaciones = presta todos
  const aptos = ((recursos ?? []) as RecursoRow[]).filter(r => {
    const set = linkByRec.get(r.recurso_id)
    return !set || set.size === 0 || set.has(datos.servicio_id!)
  })

  await guardarSesion(ctx.client_id, chatId, 'recurso', datos)

  if (aptos.length === 0) {
    await guardarSesion(ctx.client_id, chatId, null, {})
    return { texto: `No hay disponibilidad de ${et.recurso_pl.toLowerCase()} para ese ${et.servicio.toLowerCase()}.`, markup: tecladoPrincipal() }
  }
  if (aptos.length === 1) {
    // Solo uno: lo elegimos y pasamos a fecha
    datos.recurso_id = aptos[0].recurso_id; datos.recurso_nombre = aptos[0].nombre
    await guardarSesion(ctx.client_id, chatId, 'fecha', datos)
    return promptFecha()
  }

  const botones: { text: string; callback_data: string }[][] = [[{ text: 'Cualquiera', callback_data: 'crec:any' }]]
  for (const r of aptos.slice(0, 28)) botones.push([{ text: r.nombre, callback_data: `crec:${r.recurso_id}` }])
  botones.push([{ text: 'Cancelar', callback_data: 'cancelar_cita' }])
  return { texto: `¿Con qué ${et.recurso.toLowerCase()}?`, markup: { inline_keyboard: botones } }
}

function promptFecha(): BotResponse {
  return { texto: '¿Para qué día?', markup: tecladoFecha() }
}

async function mostrarSlotsCita(ctx: BotContext, chatId: string, datos: DatosCita): Promise<BotResponse> {
  const db = createAdminClient()
  const recursoParam = datos.recurso_id ? datos.recurso_id : null
  const { data, error } = await db.rpc('res_slots_cita', {
    p_client_id: ctx.client_id, p_servicio_id: datos.servicio_id!, p_recurso_id: recursoParam, p_fecha: datos.fecha!,
  })

  const slots = (!error && Array.isArray(data)) ? (data as SlotRow[]) : []
  // Hueco único por hora (en modo "cualquiera", cada hora apunta a un recurso libre)
  const porHora = new Map<string, SlotRow>()
  for (const s of slots) if (!porHora.has(s.hora)) porHora.set(s.hora, s)
  const unicos = Array.from(porHora.values()).sort((a, b) => a.hora.localeCompare(b.hora))

  if (unicos.length === 0) {
    await guardarSesion(ctx.client_id, chatId, 'fecha', datos)
    return { texto: 'No hay horarios libres ese día. Prueba con otra fecha.', markup: tecladoFecha() }
  }

  const botones: { text: string; callback_data: string }[][] = []
  for (let i = 0; i < Math.min(unicos.length, 24); i++) {
    if (i % 3 === 0) botones.push([])
    const s = unicos[i]
    botones[botones.length - 1].push({ text: s.hora, callback_data: `cslot:${s.recurso_id}:${s.hora}` })
  }
  botones.push([{ text: '← Cambiar día', callback_data: 'cfecha:otro' }])

  await guardarSesion(ctx.client_id, chatId, 'hora', datos)
  return { texto: `📅 ${formatFechaStr(datos.fecha!)}\n\nElige una hora:`, markup: { inline_keyboard: botones } }
}

function tecladoFecha() {
  return {
    inline_keyboard: [
      [{ text: 'Hoy', callback_data: 'cfecha:hoy' }, { text: 'Mañana', callback_data: 'cfecha:mañana' }],
      [{ text: 'Otro día', callback_data: 'cfecha:otro' }],
      [{ text: '← Cancelar', callback_data: 'cancelar_cita' }],
    ],
  }
}
