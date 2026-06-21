'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { hoyEnTz, ahoraEnTz } from '@/lib/fecha-tz'
import { transicionarEstado, notificarReservaNueva, type EstadoReserva } from '@/lib/reservas/estado'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type CanalReserva   = 'web' | 'bot' | 'manual'

export interface ReservaFranja {
  franja_id:        string
  client_id:        string
  nombre:           string
  hora_inicio:      string | null
  hora_fin:         string | null
  capacidad:        number
  duracion_minutos: number
  dias_semana:      number[] | null
  activa:           boolean
}

export interface Reserva {
  reserva_id:              string
  client_id:               string
  franja_id:               string
  fecha:                   string
  hora:                    string | null
  hora_fin:                string | null
  personas:                number
  nombre_cliente:          string
  telefono:                string | null
  notas:                   string | null
  canal:                   CanalReserva
  estado:                  EstadoReserva
  telegram_chat_id:        string | null
  confirmacion_automatica: boolean
  created_at:              string
  updated_at:              string
}

export interface ReservaConFranja extends Reserva {
  franja_nombre:      string
  franja_hora_inicio: string | null
  franja_hora_fin:    string | null
}

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

export interface ReservaPageData {
  reservas:   ReservaConFranja[]
  franjas:    ReservaFranja[]
  bot_config: BotConfig
  slug:       string | null
  empresas:   { empresa_id: string; nombre: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function corto(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
}
function generarFranjaId():  string { return `FRA-${corto()}` }
function generarReservaId(): string { return `RES-${corto()}` }

// "Hoy" y "ahora" en la zona del negocio (America/Havana), no en UTC ni en la
// hora del servidor (España/EEUU). Ver src/lib/fecha-tz.ts.
function hoy(): string { return hoyEnTz() }
function horaAhora(): string { return ahoraEnTz() }

const BOT_CONFIG_DEFAULTS: BotConfig = {
  token:                   null,
  nombre:                  null,
  activo:                  false,
  webhook_registrado:      false,
  notificar_owner_chat_id: null,
  confirmacion_automatica: false,
  webhook_secret:          null,
  codigo_vinculo:          null,
}

function parseBotConfig(raw: unknown): BotConfig {
  if (!raw || typeof raw !== 'object') return { ...BOT_CONFIG_DEFAULTS }
  const c = raw as Record<string, unknown>
  try {
    return {
      token:                   typeof c.token                    === 'string' ? c.token                    : null,
      nombre:                  typeof c.nombre                   === 'string' ? c.nombre                   : null,
      activo:                  typeof c.activo                   === 'boolean' ? c.activo                 : false,
      webhook_registrado:      typeof c.webhook_registrado       === 'boolean' ? c.webhook_registrado     : false,
      notificar_owner_chat_id: typeof c.notificar_owner_chat_id  === 'string'  ? c.notificar_owner_chat_id : null,
      confirmacion_automatica: typeof c.confirmacion_automatica  === 'boolean' ? c.confirmacion_automatica : false,
      webhook_secret:          typeof c.webhook_secret           === 'string'  ? c.webhook_secret          : null,
      codigo_vinculo:          typeof c.codigo_vinculo           === 'string'  ? c.codigo_vinculo          : null,
    }
  } catch {
    return { ...BOT_CONFIG_DEFAULTS }
  }
}

function formatFecha(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' })
}

// ── Obtener datos de Reservas ─────────────────────────────────────────────────

export async function obtenerReservas(): Promise<ReservaPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const [franRes, resRes, cliRes] = await Promise.all([
    db.from('reserva_franjas').select('*')
      .eq('client_id', session.client_id)
      .order('hora_inicio', { ascending: true, nullsFirst: true }),
    db.from('reservas').select('*')
      .eq('client_id', session.client_id)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('clients').select('bot_config, slug')
      .eq('client_id', session.client_id)
      .single(),
  ])

  const empresas = await obtenerEmpresas()

  const franjas  = ((franRes.data ?? []) as ReservaFranja[]).map(f => ({ ...f, capacidad: Number(f.capacidad), duracion_minutos: Number(f.duracion_minutos) }))
  const franjaPorId = new Map(franjas.map(f => [f.franja_id, f]))

  const reservas: ReservaConFranja[] = ((resRes.data ?? []) as Reserva[]).map(r => {
    const f = franjaPorId.get(r.franja_id)
    return {
      ...r,
      personas:                Number(r.personas),
      franja_nombre:           f?.nombre    ?? '—',
      franja_hora_inicio:      f?.hora_inicio ?? null,
      franja_hora_fin:         f?.hora_fin    ?? null,
    }
  })

  const bot_config = parseBotConfig(cliRes.data?.bot_config)
  const slug       = (cliRes.data?.slug as string) ?? null

  return { reservas, franjas, bot_config, slug, empresas: empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })) }
}

// ── Crear reserva (manual, desde el panel) ────────────────────────────────────

export async function crearReserva(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const franja_id      = (formData.get('franja_id')      as string)?.trim()
  const fecha          = (formData.get('fecha')           as string)?.trim()
  const horaRaw        = (formData.get('hora')            as string)?.trim()
  const personasRaw    = parseInt(formData.get('personas') as string, 10)
  const nombre_cliente = (formData.get('nombre_cliente')  as string)?.trim()
  const telefono       = (formData.get('telefono')        as string)?.trim() || null
  const notas          = (formData.get('notas')           as string)?.trim() || null

  if (!franja_id)       return { ok: false, error: 'Debes seleccionar un turno.' }
  if (!fecha)           return { ok: false, error: 'La fecha es obligatoria.' }
  if (fecha < hoy())    return { ok: false, error: 'No se puede crear una reserva en una fecha pasada.' }
  if (!nombre_cliente)  return { ok: false, error: 'El nombre del cliente es obligatorio.' }

  const personas = isNaN(personasRaw) || personasRaw < 1 ? 1 : personasRaw
  const hora     = horaRaw || '12:00:00'

  if (fecha === hoy() && hora <= horaAhora()) return { ok: false, error: 'Esa hora ya pasó. Elige una hora futura.' }

  const db = createAdminClient()

  // Confirmación automática
  const { data: cliente } = await db.from('clients')
    .select('bot_config')
    .eq('client_id', session.client_id)
    .single()
  const botCfg = parseBotConfig(cliente?.bot_config)

  // Función atómica: comprueba disponibilidad por solapamiento + inserta
  const { data, error } = await db.rpc('res_crear_reserva', {
    p_client_id:               session.client_id,
    p_franja_id:               franja_id,
    p_fecha:                   fecha,
    p_hora:                    hora,
    p_personas:                personas,
    p_nombre_cliente:          nombre_cliente,
    p_telefono:                telefono,
    p_notas:                   notas,
    p_canal:                   'manual',
    p_confirmacion_automatica: botCfg.confirmacion_automatica,
    p_reserva_id:              generarReservaId(),
  })

  if (error) return { ok: false, error: error.message }
  const result = data as { ok: boolean; error?: string }
  if (!result.ok) return { ok: false, error: result.error ?? 'Error al crear la reserva.' }

  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Modificar reserva ─────────────────────────────────────────────────────────

export async function modificarReserva(
  reserva_id: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const franja_id      = (formData.get('franja_id')      as string)?.trim()
  const fecha          = (formData.get('fecha')           as string)?.trim()
  const horaRaw        = (formData.get('hora')            as string)?.trim()
  const personasRaw    = parseInt(formData.get('personas') as string, 10)
  const nombre_cliente = (formData.get('nombre_cliente')  as string)?.trim()
  const telefono       = (formData.get('telefono')        as string)?.trim() || null
  const notas          = (formData.get('notas')           as string)?.trim() || null

  if (!franja_id)       return { ok: false, error: 'Debes seleccionar un turno.' }
  if (!fecha)           return { ok: false, error: 'La fecha es obligatoria.' }
  if (!nombre_cliente)  return { ok: false, error: 'El nombre del cliente es obligatorio.' }

  const db       = createAdminClient()
  const personas = isNaN(personasRaw) || personasRaw < 1 ? 1 : personasRaw
  const hora     = horaRaw || '12:00:00'

  if (fecha < hoy())                                       return { ok: false, error: 'No se puede poner una fecha pasada.' }
  if (fecha === hoy() && hora <= horaAhora())              return { ok: false, error: 'Esa hora ya pasó hoy.' }

  // Función atómica: lock por (negocio, franja, fecha) + reglas (día de la semana,
  // capacidad por solapamiento excluyendo la propia reserva) + update, en una sola
  // transacción. Evita la carrera del check-then-write anterior.
  const { data, error } = await db.rpc('res_modificar_reserva', {
    p_client_id:      session.client_id,
    p_reserva_id:     reserva_id,
    p_franja_id:      franja_id,
    p_fecha:          fecha,
    p_hora:           hora,
    p_personas:       personas,
    p_nombre_cliente: nombre_cliente,
    p_telefono:       telefono,
    p_notas:          notas,
  })

  if (error) return { ok: false, error: error.message }
  const result = data as { ok: boolean; error?: string }
  if (!result.ok) return { ok: false, error: result.error ?? 'Error al modificar la reserva.' }

  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Cambiar estado de una reserva ─────────────────────────────────────────────

export async function cambiarEstadoReserva(
  reserva_id: string,
  nuevoEstado: EstadoReserva,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  // bot_config + nombre para avisar al cliente por Telegram si procede
  const { data: cli } = await db.from('clients')
    .select('bot_config, nombre_empresa')
    .eq('client_id', session.client_id)
    .single()
  const botCfg = parseBotConfig(cli?.bot_config)

  // Transición validada (máquina de estados) + aviso al cliente (canal bot)
  const r = await transicionarEstado(
    db, session.client_id, reserva_id, nuevoEstado,
    (cli?.nombre_empresa as string) ?? 'Tu reserva',
    { token: botCfg.token, activo: botCfg.activo },
  )
  if (!r.ok) return r

  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Guardar franja (crear / editar) ───────────────────────────────────────────

export async function guardarFranja(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const franja_id      = (formData.get('franja_id')      as string)?.trim()
  const nombre         = (formData.get('nombre')         as string)?.trim()
  const hora_inicio    = (formData.get('hora_inicio')    as string)?.trim()
  const hora_fin       = (formData.get('hora_fin')       as string)?.trim()
  const capacidadRaw   = parseInt(formData.get('capacidad') as string, 10)
  const duracionRaw    = parseInt(formData.get('duracion_minutos') as string, 10)

  if (!nombre)      return { ok: false, error: 'El nombre del turno es obligatorio.' }
  if (!hora_inicio) return { ok: false, error: 'La hora de inicio es obligatoria.' }
  if (!hora_fin)    return { ok: false, error: 'La hora de fin es obligatoria.' }
  if (hora_inicio >= hora_fin) return { ok: false, error: 'La hora de fin debe ser posterior a la de inicio.' }
  const capacidad  = isNaN(capacidadRaw) || capacidadRaw < 1 ? 1 : capacidadRaw
  const duracion   = isNaN(duracionRaw)  || duracionRaw  < 15 ? 60 : duracionRaw

  // dias_semana: array de checkboxes (1-7)
  const diasRaw = formData.getAll('dias_semana').map(v => parseInt(v as string, 10)).filter(d => d >= 1 && d <= 7)
  const dias_semana = diasRaw.length > 0 ? diasRaw : null

  const db = createAdminClient()

  // Validar que no se solape con otra franja activa (mismo rango horario + mismos días)
  const solapeQuery = db.from('reserva_franjas')
    .select('franja_id, nombre')
    .eq('client_id', session.client_id)
    .eq('activa', true)
    .lt('hora_inicio', hora_fin)
    .gt('hora_fin', hora_inicio)
  if (franja_id) solapeQuery.neq('franja_id', franja_id)
  const { data: solapadas } = await solapeQuery
  if (solapadas && solapadas.length > 0) {
    return { ok: false, error: `El horario se solapa con «${solapadas[0].nombre}». Ajusta las horas.` }
  }

  if (!franja_id) {
    const { error } = await db.from('reserva_franjas').insert({
      franja_id: generarFranjaId(),
      client_id: session.client_id,
      nombre,
      hora_inicio,
      hora_fin,
      capacidad,
      duracion_minutos: duracion,
      dias_semana,
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('reserva_franjas')
      .update({ nombre, hora_inicio, hora_fin, capacidad, duracion_minutos: duracion, dias_semana, updated_at: new Date().toISOString() })
      .eq('franja_id', franja_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Eliminar franja ───────────────────────────────────────────────────────────

export async function eliminarFranja(franja_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  // Bloquear si tiene reservas pendientes o confirmadas (futuras o de hoy)
  const { count } = await db.from('reservas')
    .select('reserva_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id)
    .eq('franja_id', franja_id)
    .gte('fecha', hoy())
    .in('estado', ['PENDIENTE', 'CONFIRMADA'])
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'El turno tiene reservas pendientes o confirmadas. Cancélalas o reasígnalas antes de eliminar.' }
  }

  const { error } = await db.from('reserva_franjas')
    .delete()
    .eq('franja_id', franja_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Guardar configuración del bot ─────────────────────────────────────────────

export async function guardarBotConfig(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const token                = (formData.get('token')                 as string)?.trim() || null
  const nombre               = (formData.get('nombre')                as string)?.trim() || null
  const activo               = formData.get('activo')              === 'true'
  const confirmacionAutomatica = formData.get('confirmacion_automatica') === 'true'

  if (activo && !token) return { ok: false, error: 'El token del bot es obligatorio para activarlo.' }

  const db = createAdminClient()

  // Leer config actual para no pisar campos que no vienen en el form
  const { data: cliente } = await db.from('clients')
    .select('bot_config')
    .eq('client_id', session.client_id)
    .single()
  const actual = parseBotConfig(cliente?.bot_config)

  // Secreto del webhook (verifica el origen de los updates) y código para que el
  // dueño vincule su chat (/start <codigo>). Se generan una vez y persisten.
  const webhookSecret = actual.webhook_secret ?? crypto.randomUUID().replace(/-/g, '')
  const codigoVinculo = actual.codigo_vinculo ?? corto()

  const nuevaConfig = {
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

  const { error } = await db.from('clients')
    .update({ bot_config: nuevaConfig })
    .eq('client_id', session.client_id)
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
    // Actualizar estado del webhook
    await db.from('clients')
      .update({ bot_config: nuevaConfig })
      .eq('client_id', session.client_id)
  }

  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Activar / desactivar bot ───────────────────────────────────────────────────

export async function toggleActivoBot(
  activo: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const { data: cliente } = await db.from('clients')
    .select('bot_config')
    .eq('client_id', session.client_id)
    .single()

  const actual = parseBotConfig(cliente?.bot_config)

  if (!actual.token) return { ok: false, error: 'No hay un bot configurado.' }

  const nuevaConfig = { ...actual, activo }

  const { error } = await db.from('clients')
    .update({ bot_config: nuevaConfig })
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Eliminar configuración del bot ─────────────────────────────────────────────

export async function eliminarBotConfig(): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const { data: cliente } = await db.from('clients')
    .select('bot_config')
    .eq('client_id', session.client_id)
    .single()

  const actual = parseBotConfig(cliente?.bot_config)

  // Quitar el webhook en Telegram (best-effort) antes de borrar la config
  if (actual.token) {
    try {
      await fetch(`https://api.telegram.org/bot${actual.token}/deleteWebhook`, { method: 'POST' })
    } catch { /* no-op */ }
  }

  const nuevaConfig = {
    ...actual,
    token: null,
    nombre: null,
    activo: false,
    webhook_registrado: false,
    notificar_owner_chat_id: null,
    webhook_secret: null,
    codigo_vinculo: null,
  }

  const { error } = await db.from('clients')
    .update({ bot_config: nuevaConfig })
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Guardar slug público ──────────────────────────────────────────────────────

export async function guardarSlug(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const slugRaw = (formData.get('slug') as string)?.trim() ?? ''

  let slug: string | null = null
  if (slugRaw) {
    slug = slugRaw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (!slug || slug.length < 2) return { ok: false, error: 'Mínimo 2 caracteres (letras, números o guiones).' }

    const db = createAdminClient()
    const { data: existente } = await db.from('clients')
      .select('client_id')
      .eq('slug', slug)
      .neq('client_id', session.client_id)
      .maybeSingle()
    if (existente) return { ok: false, error: 'Ese enlace ya lo está usando otro negocio.' }
  }

  const db = createAdminClient()
  const { error } = await db.from('clients')
    .update({ slug })
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Reserva pública (sin sesión de portal, desde el formulario web) ───────────

export async function crearReservaPublica(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; reserva_id?: string }> {
  const client_id = (formData.get('client_id')  as string)?.trim()
  const franja_id = (formData.get('franja_id')  as string)?.trim()
  const fecha     = (formData.get('fecha')      as string)?.trim()
  const hora      = (formData.get('hora')       as string)?.trim() || null
  const personasRaw = parseInt(formData.get('personas') as string, 10)
  const nombre_cliente = (formData.get('nombre')  as string)?.trim()
  const telefono  = (formData.get('telefono')   as string)?.trim() || null
  const notas     = (formData.get('notas')      as string)?.trim() || null

  if (!client_id)       return { ok: false, error: 'Negocio no identificado.' }
  if (!franja_id)       return { ok: false, error: 'Franja no especificada.' }
  if (!fecha)           return { ok: false, error: 'Fecha obligatoria.' }
  if (fecha < hoy())    return { ok: false, error: 'No se puede reservar en una fecha pasada.' }
  if (!nombre_cliente)  return { ok: false, error: 'Nombre obligatorio.' }

  const personas = isNaN(personasRaw) || personasRaw < 1 ? 1 : personasRaw
  const horaVal  = hora || '12:00:00'

  if (fecha === hoy() && horaVal <= horaAhora()) return { ok: false, error: 'Esa hora ya pasó. Elige una hora futura.' }

  const db = createAdminClient()

  // Confirmación automática + datos para notificar al dueño
  const { data: cliente } = await db.from('clients')
    .select('bot_config, nombre_empresa')
    .eq('client_id', client_id)
    .single()
  const botCfg = parseBotConfig(cliente?.bot_config)

  const reservaId = generarReservaId()

  // Función atómica: comprueba disponibilidad por solapamiento + inserta
  const { data, error } = await db.rpc('res_crear_reserva', {
    p_client_id:               client_id,
    p_franja_id:               franja_id,
    p_fecha:                   fecha,
    p_hora:                    horaVal,
    p_personas:                personas,
    p_nombre_cliente:          nombre_cliente,
    p_telefono:                telefono,
    p_notas:                   notas,
    p_canal:                   'web',
    p_confirmacion_automatica: botCfg.confirmacion_automatica,
    p_reserva_id:              reservaId,
  })

  if (error) return { ok: false, error: error.message }
  const result = data as { ok: boolean; error?: string }
  if (!result.ok) return { ok: false, error: result.error ?? 'Error al crear la reserva.' }

  // Avisar al dueño por Telegram (no-op si no hay bot activo / sin chat vinculado)
  await notificarReservaNueva(
    { token: botCfg.token, activo: botCfg.activo, notificar_owner_chat_id: botCfg.notificar_owner_chat_id },
    {
      reserva_id: reservaId, fecha, hora: horaVal, personas,
      nombre_cliente, telefono, notas,
      estado: botCfg.confirmacion_automatica ? 'CONFIRMADA' : 'PENDIENTE',
      telegram_chat_id: null,
    },
    (cliente?.nombre_empresa as string) ?? 'Tu negocio',
  )

  return { ok: true, reserva_id: reservaId }
}

// ── Datos públicos para el formulario de reservas ──────────────────────────────

export interface FranjaPublica {
  franja_id:        string
  nombre:           string
  hora_inicio:      string | null
  hora_fin:         string | null
  capacidad:        number
  duracion_minutos: number
  dias_semana:      number[] | null
}

export interface NegocioPublico {
  nombre: string
  slug:   string | null
}

export async function obtenerReservasPublicas(slug: string): Promise<{
  negocio:  NegocioPublico | null
  franjas:  FranjaPublica[]
  client_id: string | null
}> {
  const db = createAdminClient()

  const { data: cliente } = await db.from('clients')
    .select('client_id, nombre_empresa, slug')
    .eq('slug', slug)
    .single()

  if (!cliente) return { negocio: null, franjas: [], client_id: null }

  const { data: franjas } = await db.from('reserva_franjas')
    .select('franja_id, nombre, hora_inicio, hora_fin, capacidad, duracion_minutos, dias_semana')
    .eq('client_id', cliente.client_id)
    .eq('activa', true)
    .order('hora_inicio', { ascending: true, nullsFirst: true })

  return {
    negocio:  { nombre: cliente.nombre_empresa, slug: cliente.slug },
    franjas:  ((franjas ?? []) as FranjaPublica[]).map(f => ({ ...f, capacidad: Number(f.capacidad), duracion_minutos: Number(f.duracion_minutos) })),
    client_id: cliente.client_id,
  }
}

export async function obtenerDisponibilidadPublica(
  client_id: string,
  franja_id: string,
  fecha: string,
  hora?: string,
): Promise<{ disponibles: number }> {
  const db = createAdminClient()

  const { data: franja } = await db.from('reserva_franjas')
    .select('capacidad, duracion_minutos')
    .eq('franja_id', franja_id)
    .eq('client_id', client_id)
    .single()

  if (!franja) return { disponibles: 0 }

  const horaVal   = hora || '12:00:00'
  const duracion  = Number(franja.duracion_minutos) || 60
  const horaLim   = new Date(`1970-01-01T${horaVal}`)
  horaLim.setMinutes(horaLim.getMinutes() + duracion)
  const horaFin   = horaLim.toTimeString().substring(0, 8)

  // Solapamiento real: reservas cuyo rango pise el rango solicitado
  const { data: ocupantes } = await db.from('reservas')
    .select('personas')
    .eq('client_id', client_id)
    .eq('franja_id', franja_id)
    .eq('fecha', fecha)
    .in('estado', ['PENDIENTE', 'CONFIRMADA'])
    .lt('hora', horaFin)
    .gt('hora_fin', horaVal)

  const ocupado = (ocupantes ?? []).reduce((s: number, r: { personas: number }) => s + Number(r.personas), 0)
  return { disponibles: Math.max(0, Number(franja.capacidad) - ocupado) }
}
