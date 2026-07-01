'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { hoyEnTz, ahoraEnTz } from '@/lib/fecha-tz'
import { transicionarEstado, notificarReservaNueva, type EstadoReserva } from '@/lib/reservas/estado'
import { type BotConfig, parseBotConfig, guardarBotConfigCol, toggleActivoBotCol, eliminarBotConfigCol, guardarConfirmacionCol, guardarIaActivaCol } from '@/lib/reservas/bot-config'
import { tieneModulo } from '@/lib/modulos'
import { enviarMensaje } from '@/lib/telegram/enviar'
import { rateLimitOk } from '@/lib/rate-limit'
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

export interface Cierre {
  cierre_id:   string
  fecha_desde: string
  fecha_hasta: string
  motivo:      string | null
}

export interface ReglasReserva {
  antelacion_min_horas: number
  ventana_max_dias:     number
  max_personas:         number
}

export interface ReservaPageData {
  reservas:   ReservaConFranja[]
  franjas:    ReservaFranja[]
  bot_config: BotConfig
  slug:       string | null
  empresas:   { empresa_id: string; nombre: string }[]
  cierres:    Cierre[]
  reglas:     ReglasReserva
  tieneIa:    boolean   // addon asistente_ia contratado → se ofrece el toggle de IA del bot
}

const REGLAS_DEFAULT: ReglasReserva = { antelacion_min_horas: 0, ventana_max_dias: 0, max_personas: 0 }

function parseReglas(c: Record<string, unknown> | null | undefined): ReglasReserva {
  if (!c) return { ...REGLAS_DEFAULT }
  return {
    antelacion_min_horas: Number(c.reserva_antelacion_min_horas ?? 0) || 0,
    ventana_max_dias:     Number(c.reserva_ventana_max_dias ?? 0) || 0,
    max_personas:         Number(c.reserva_max_personas ?? 0) || 0,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function corto(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
}
function generarFranjaId():  string { return `FRA-${corto()}` }
function generarReservaId(): string { return `RES-${corto()}` }
function generarCierreId():  string { return `CIE-${corto()}` }

// Validación básica de correo (suficiente para el formulario público; el navegador
// ya aplica type="email"). Evita guardar basura sin pretender RFC completa.
function emailValido(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

// Cierres/festivos vigentes (hoy en adelante) del negocio
async function cargarCierres(db: ReturnType<typeof createAdminClient>, client_id: string): Promise<Cierre[]> {
  const { data } = await db.from('reserva_cierres')
    .select('cierre_id, fecha_desde, fecha_hasta, motivo')
    .eq('client_id', client_id)
    .gte('fecha_hasta', hoyEnTz())
    .order('fecha_desde')
  return (data ?? []) as Cierre[]
}

// "Hoy" y "ahora" en la zona del negocio (America/Havana), no en UTC ni en la
// hora del servidor (España/EEUU). Ver src/lib/fecha-tz.ts.
function hoy(): string { return hoyEnTz() }
function horaAhora(): string { return ahoraEnTz() }

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
    // Solo reservas (franja); las citas viven en la misma tabla con recurso_id
    // — se excluyen aquí para que no aparezcan en la lista de Reservas.
    db.from('reservas').select('*')
      .eq('client_id', session.client_id)
      .is('recurso_id', null)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('clients').select('bot_config, slug, modulos_activos, reserva_antelacion_min_horas, reserva_ventana_max_dias, reserva_max_personas')
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
  const cierres    = await cargarCierres(db, session.client_id)
  const reglas     = parseReglas(cliRes.data as Record<string, unknown> | null)
  const tieneIa    = tieneModulo(cliRes.data?.modulos_activos, 'asistente_ia')

  return { reservas, franjas, bot_config, slug, empresas: empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })), cierres, reglas, tieneIa }
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

  const r = await guardarBotConfigCol(createAdminClient(), session.client_id, 'bot_config', {
    token:                  (formData.get('token')  as string)?.trim() || null,
    nombre:                 (formData.get('nombre') as string)?.trim() || null,
    activo:                 formData.get('activo') === 'true',
    confirmacionAutomatica: formData.get('confirmacion_automatica') === 'true',
  })
  if (!r.ok) return r
  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Confirmación automática (se guarda sola, sin depender del bot) ─────────────

export async function guardarConfirmacionReservas(activa: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const r = await guardarConfirmacionCol(createAdminClient(), session.client_id, 'bot_config', activa)
  if (!r.ok) return r
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

  const r = await toggleActivoBotCol(createAdminClient(), session.client_id, 'bot_config', activo)
  if (!r.ok) return r
  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── IA del bot (requiere addon asistente_ia) ───────────────────────────────────

export async function toggleIaBotReservas(activa: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('modulos_activos').eq('client_id', session.client_id).single()
  if (!tieneModulo(cli?.modulos_activos, 'asistente_ia')) return { ok: false, error: 'El asistente IA no está contratado.' }

  const r = await guardarIaActivaCol(db, session.client_id, 'bot_config', activa)
  if (!r.ok) return r
  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Eliminar configuración del bot ─────────────────────────────────────────────

export async function eliminarBotConfig(): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const r = await eliminarBotConfigCol(createAdminClient(), session.client_id, 'bot_config')
  if (!r.ok) return r
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

// ── Cierres / festivos (compartidos por Reservas y Citas) ──────────────────────

export async function guardarCierre(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const desde    = (formData.get('fecha_desde') as string)?.trim()
  const hastaRaw = (formData.get('fecha_hasta') as string)?.trim()
  const motivo   = (formData.get('motivo')      as string)?.trim() || null
  if (!desde) return { ok: false, error: 'La fecha es obligatoria.' }
  const hasta = hastaRaw || desde
  if (hasta < desde) return { ok: false, error: 'La fecha final no puede ser anterior a la inicial.' }

  const db = createAdminClient()
  const { error } = await db.from('reserva_cierres').insert({
    cierre_id: generarCierreId(), client_id: session.client_id, fecha_desde: desde, fecha_hasta: hasta, motivo,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/reservas')
  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function eliminarCierre(cierre_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { error } = await db.from('reserva_cierres').delete()
    .eq('cierre_id', cierre_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/reservas')
  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Reglas de reserva (config de negocio, compartida con Citas) ────────────────

export async function guardarReglas(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const ent = (k: string) => {
    const n = parseInt(formData.get(k) as string, 10)
    return isNaN(n) || n < 0 ? 0 : n
  }

  const db = createAdminClient()
  const { error } = await db.from('clients').update({
    reserva_antelacion_min_horas: ent('antelacion_min_horas'),
    reserva_ventana_max_dias:     ent('ventana_max_dias'),
    reserva_max_personas:         ent('max_personas'),
  }).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/reservas')
  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Reserva pública (sin sesión de portal, desde el formulario web) ───────────

export async function crearReservaPublica(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; reserva_id?: string; token?: string; estado?: EstadoReserva }> {
  // Honeypot: campo oculto que solo rellenan los bots → fingir éxito sin crear nada
  if ((formData.get('hp') as string)?.trim()) return { ok: true }

  // Rate limit por IP (anti-spam de reservas)
  if (!await rateLimitOk('reserva_crear', 5, 300)) {
    return { ok: false, error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }
  }

  const client_id = (formData.get('client_id')  as string)?.trim()
  const franja_id = (formData.get('franja_id')  as string)?.trim()
  const fecha     = (formData.get('fecha')      as string)?.trim()
  const hora      = (formData.get('hora')       as string)?.trim() || null
  const personasRaw = parseInt(formData.get('personas') as string, 10)
  const nombre_cliente = (formData.get('nombre')  as string)?.trim()
  const telefono  = (formData.get('telefono')   as string)?.trim() || null
  const email     = (formData.get('email')      as string)?.trim() || ''
  const notas     = (formData.get('notas')      as string)?.trim() || null

  if (!client_id)       return { ok: false, error: 'Negocio no identificado.' }
  if (!franja_id)       return { ok: false, error: 'Franja no especificada.' }
  if (!fecha)           return { ok: false, error: 'Fecha obligatoria.' }
  if (fecha < hoy())    return { ok: false, error: 'No se puede reservar en una fecha pasada.' }
  if (!nombre_cliente)  return { ok: false, error: 'Nombre obligatorio.' }
  if (!email)           return { ok: false, error: 'Correo obligatorio.' }
  if (!emailValido(email)) return { ok: false, error: 'Correo no válido.' }

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

  // Correo del cliente: se guarda tras la inserción atómica (no es columna de la RPC).
  await db.from('reservas').update({ email }).eq('reserva_id', reservaId)

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

  // Token público para que el cliente pueda gestionar/cancelar su reserva
  const { data: tk } = await db.from('reservas').select('token').eq('reserva_id', reservaId).single()

  return {
    ok: true,
    reserva_id: reservaId,
    token: (tk?.token as string) ?? undefined,
    estado: botCfg.confirmacion_automatica ? 'CONFIRMADA' : 'PENDIENTE',
  }
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
  reglas:   ReglasReserva
}> {
  const db = createAdminClient()

  const { data: cliente } = await db.from('clients')
    .select('client_id, nombre_empresa, slug, reserva_antelacion_min_horas, reserva_ventana_max_dias, reserva_max_personas')
    .eq('slug', slug)
    .single()

  if (!cliente) return { negocio: null, franjas: [], client_id: null, reglas: { ...REGLAS_DEFAULT } }

  const { data: franjas } = await db.from('reserva_franjas')
    .select('franja_id, nombre, hora_inicio, hora_fin, capacidad, duracion_minutos, dias_semana')
    .eq('client_id', cliente.client_id)
    .eq('activa', true)
    .order('hora_inicio', { ascending: true, nullsFirst: true })

  return {
    negocio:  { nombre: cliente.nombre_empresa, slug: cliente.slug },
    franjas:  ((franjas ?? []) as FranjaPublica[]).map(f => ({ ...f, capacidad: Number(f.capacidad), duracion_minutos: Number(f.duracion_minutos) })),
    client_id: cliente.client_id,
    reglas:   parseReglas(cliente as Record<string, unknown>),
  }
}

export async function obtenerDisponibilidadPublica(
  client_id: string,
  franja_id: string,
  fecha: string,
  hora?: string,
): Promise<{ disponibles: number }> {
  // Límite generoso para lecturas públicas de disponibilidad (anti-scraping)
  if (!await rateLimitOk('disp_reserva', 90, 60)) return { disponibles: 0 }
  const db = createAdminClient()

  // Negocio cerrado ese día (festivo/cierre) → sin disponibilidad
  const { data: cerr } = await db.from('reserva_cierres').select('cierre_id')
    .eq('client_id', client_id).lte('fecha_desde', fecha).gte('fecha_hasta', fecha).limit(1)
  if (cerr && cerr.length > 0) return { disponibles: 0 }

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

// ── Disponibilidad de aforo en 1 query (mini-web pública) ──────────────────────

export interface SlotAforo {
  hora:      string   // HH:MM
  franja_id: string
  libre:     boolean
}

export async function obtenerSlotsAforo(
  client_id: string, fecha: string, personas: number,
): Promise<SlotAforo[]> {
  if (!await rateLimitOk('slots_aforo', 90, 60)) return []
  const db = createAdminClient()
  const { data, error } = await db.rpc('res_slots_aforo', {
    p_client_id: client_id, p_fecha: fecha, p_personas: personas < 1 ? 1 : personas,
  })
  if (error || !Array.isArray(data)) return []
  return data as SlotAforo[]
}

export async function obtenerProximoDiaAforo(
  client_id: string, personas: number, desde: string,
): Promise<{ fecha: string | null }> {
  if (!await rateLimitOk('slots_aforo', 90, 60)) return { fecha: null }
  const db = createAdminClient()
  const { data, error } = await db.rpc('res_proximo_dia_aforo', {
    p_client_id: client_id, p_personas: personas < 1 ? 1 : personas, p_desde: desde, p_dias: 60,
  })
  if (error) return { fecha: null }
  return { fecha: (data as string | null) ?? null }
}

export interface DiaDisponibleAforo {
  fecha:        string  // YYYY-MM-DD
  primera_hora: string  // HH:MM — primer hueco libre del día
  libres:       number  // nº de horas libres ese día
}

// Próximos días con hueco libre (para la rejilla de fechas de la mini-web).
export async function obtenerDiasDisponiblesAforo(
  client_id: string, personas: number, desde?: string,
): Promise<DiaDisponibleAforo[]> {
  if (!await rateLimitOk('dias_aforo', 60, 60)) return []
  const db = createAdminClient()
  const { data, error } = await db.rpc('res_dias_disponibles_aforo', {
    p_client_id: client_id, p_personas: personas < 1 ? 1 : personas,
    p_desde: desde ?? hoyEnTz(), p_max_dias: 30,
  })
  if (error || !Array.isArray(data)) return []
  return data as DiaDisponibleAforo[]
}

// ── Gestión pública por token (cancelar reserva/cita sin cuenta) ───────────────

export interface ReservaPublicaToken {
  token:          string
  tipo:           'reserva' | 'cita'
  negocio:        string
  slug:           string | null
  fecha:          string
  hora:           string | null
  hora_fin:       string | null
  personas:       number
  nombre_cliente: string
  detalle:        string          // turno, o "servicio · recurso"
  estado:         EstadoReserva
  cancelable:     boolean
}

export async function obtenerReservaPublicaPorToken(token: string): Promise<ReservaPublicaToken | null> {
  if (!token) return null
  const db = createAdminClient()

  const { data: r } = await db.from('reservas')
    .select('client_id, franja_id, recurso_id, servicio_id, fecha, hora, hora_fin, personas, nombre_cliente, estado, token')
    .eq('token', token)
    .maybeSingle()
  if (!r) return null

  const { data: cli } = await db.from('clients')
    .select('nombre_empresa, slug').eq('client_id', r.client_id).single()

  const esCita = !!r.recurso_id
  let detalle = '—'
  if (esCita) {
    const [srv, rec] = await Promise.all([
      r.servicio_id ? db.from('servicios').select('nombre').eq('servicio_id', r.servicio_id).maybeSingle() : Promise.resolve({ data: null }),
      db.from('recursos').select('nombre').eq('recurso_id', r.recurso_id).maybeSingle(),
    ])
    detalle = [srv.data?.nombre, rec.data?.nombre].filter(Boolean).join(' · ') || '—'
  } else if (r.franja_id) {
    const { data: fr } = await db.from('reserva_franjas').select('nombre').eq('franja_id', r.franja_id).maybeSingle()
    detalle = fr?.nombre ?? '—'
  }

  const estado = r.estado as EstadoReserva
  const cancelable = (estado === 'PENDIENTE' || estado === 'CONFIRMADA') && r.fecha >= hoy()

  return {
    token:          r.token as string,
    tipo:           esCita ? 'cita' : 'reserva',
    negocio:        (cli?.nombre_empresa as string) ?? 'Negocio',
    slug:           (cli?.slug as string) ?? null,
    fecha:          r.fecha as string,
    hora:           (r.hora as string) ?? null,
    hora_fin:       (r.hora_fin as string) ?? null,
    personas:       Number(r.personas),
    nombre_cliente: r.nombre_cliente as string,
    detalle,
    estado,
    cancelable,
  }
}

export async function cancelarReservaPublica(token: string): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: 'Enlace no válido.' }
  if (!await rateLimitOk('reserva_cancelar', 10, 300)) {
    return { ok: false, error: 'Demasiados intentos. Espera unos minutos.' }
  }
  const db = createAdminClient()

  const { data: r } = await db.from('reservas')
    .select('reserva_id, client_id, recurso_id, fecha, hora, personas, nombre_cliente, estado')
    .eq('token', token)
    .maybeSingle()
  if (!r) return { ok: false, error: 'Reserva no encontrada.' }

  const estado = r.estado as EstadoReserva
  if (estado !== 'PENDIENTE' && estado !== 'CONFIRMADA') {
    return { ok: false, error: 'Esta reserva ya no se puede cancelar.' }
  }
  if ((r.fecha as string) < hoy()) {
    return { ok: false, error: 'No se puede cancelar una reserva pasada.' }
  }

  const { error } = await db.from('reservas')
    .update({ estado: 'CANCELADA', updated_at: new Date().toISOString() })
    .eq('reserva_id', r.reserva_id)
    .eq('client_id', r.client_id)
  if (error) return { ok: false, error: error.message }

  // Avisar al dueño por su bot (independiente por funcionalidad: Citas usa
  // bot_config_citas; Reservas usa bot_config). No-op si no hay bot/chat.
  const esCita = !!r.recurso_id
  const columna = esCita ? 'bot_config_citas' : 'bot_config'
  const { data: cli } = await db.from('clients').select(`${columna}, nombre_empresa`).eq('client_id', r.client_id).single()
  const botCfg = parseBotConfig((cli as Record<string, unknown> | null)?.[columna])
  if (botCfg.token && botCfg.activo && botCfg.notificar_owner_chat_id) {
    const [y, m, d] = (r.fecha as string).split('-')
    const hhmm = r.hora ? (r.hora as string).substring(0, 5) : '—'
    const texto = [
      `🚫 ${esCita ? 'Cita' : 'Reserva'} cancelada por el cliente — ${(cli?.nombre_empresa as string) ?? ''}`.trim(),
      `📅 ${d}/${m}/${y}  🕐 ${hhmm}`,
      `👥 ${Number(r.personas)}  ·  ${r.nombre_cliente as string}`,
    ].join('\n')
    await enviarMensaje(botCfg.token, botCfg.notificar_owner_chat_id, texto)
  }

  return { ok: true }
}
