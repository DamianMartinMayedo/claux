'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { hoyEnTz, ahoraEnTz } from '@/lib/fecha-tz'
import { transicionarEstado, notificarReservaNueva, type EstadoReserva } from '@/lib/reservas/estado'
import { type BotConfig, parseBotConfig, guardarBotConfigCol, toggleActivoBotCol, eliminarBotConfigCol, guardarConfirmacionCol } from '@/lib/reservas/bot-config'
import { etiquetasDe, ETIQUETAS_DEFAULT, type EtiquetasSector } from '@/lib/sector'
import { rateLimitOk } from '@/lib/rate-limit'
import { tieneModulo } from '@/lib/modulos'
import { type Cierre, type ReglasReserva } from './reservas'
import { getPortalSession }  from './auth'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface Servicio {
  servicio_id:      string
  nombre:           string
  duracion_minutos: number
  precio:           number | null
  activo:           boolean
}

export interface RecursoHorario {
  dia_semana:  number
  hora_inicio: string  // HH:MM
  hora_fin:    string  // HH:MM
}

export interface Recurso {
  recurso_id:   string
  nombre:       string
  tipo:         string | null
  activo:       boolean
  empleado_id:  string | null  // vínculo opcional con un empleado de RRHH
  servicio_ids: string[]      // servicios que presta (vacío = todos)
  horarios:     RecursoHorario[]
}

export interface EmpleadoRRHH {
  empleado_id:  string
  nombre:       string
  ya_importado: boolean
}

export interface Cita {
  reserva_id:     string
  client_id:      string
  recurso_id:     string | null
  servicio_id:    string | null
  fecha:          string
  hora:           string | null
  hora_fin:       string | null
  nombre_cliente: string
  telefono:       string | null
  notas:          string | null
  canal:          'web' | 'bot' | 'manual'
  estado:         EstadoReserva
  telegram_chat_id: string | null
  created_at:     string
}

export interface CitaConDetalle extends Cita {
  recurso_nombre:  string
  servicio_nombre: string
  servicio_duracion: number
}

export interface CitasPageData {
  client_id:   string
  citas:       CitaConDetalle[]
  recursos:    Recurso[]
  servicios:   Servicio[]
  slug:        string | null
  etiquetas:   EtiquetasSector
  bot_config:  BotConfig
  rrhh_activo: boolean
  empleados:   EmpleadoRRHH[]   // del módulo RRHH (vacío si no está activo)
  cierres:     Cierre[]         // festivos/cierres del negocio (compartidos con Reservas)
  reglas:      ReglasReserva    // antelación/ventana (compartidas con Reservas)
}

function reglasDe(c: Record<string, unknown> | null | undefined): ReglasReserva {
  return {
    antelacion_min_horas: Number(c?.reserva_antelacion_min_horas ?? 0) || 0,
    ventana_max_dias:     Number(c?.reserva_ventana_max_dias ?? 0) || 0,
    max_personas:         Number(c?.reserva_max_personas ?? 0) || 0,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function corto(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
}
function generarRecursoId():  string { return `REC-${corto()}` }
function generarServicioId(): string { return `SER-${corto()}` }
function generarHorarioId():  string { return `RHO-${corto()}` }
function generarReservaId():  string { return `RES-${corto()}` }

function hoy(): string { return hoyEnTz() }
function horaAhora(): string { return ahoraEnTz() }

// Validación básica de correo (el navegador ya aplica type="email").
function emailValido(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

function hhmm(t: string | null): string { return t ? t.substring(0, 5) : '' }

async function etiquetasDeSector(db: ReturnType<typeof createAdminClient>, sector: string | null): Promise<EtiquetasSector> {
  if (!sector) return { ...ETIQUETAS_DEFAULT }
  const { data: pl } = await db.from('plantillas_sector').select('etiquetas').eq('sector', sector).maybeSingle()
  return etiquetasDe(pl?.etiquetas)
}

// ── Datos del portal ───────────────────────────────────────────────────────────

export async function obtenerCitasData(): Promise<CitasPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const cid = session.client_id

  const [recRes, srvRes, rsRes, rhRes, citasRes, cliRes] = await Promise.all([
    db.from('recursos').select('*').eq('client_id', cid).order('nombre'),
    db.from('servicios').select('*').eq('client_id', cid).order('nombre'),
    db.from('recurso_servicios').select('recurso_id, servicio_id'),
    db.from('recurso_horarios').select('recurso_id, dia_semana, hora_inicio, hora_fin').eq('client_id', cid),
    db.from('reservas').select('*').eq('client_id', cid).not('recurso_id', 'is', null)
      .order('fecha', { ascending: false }).order('hora', { ascending: true }),
    db.from('clients').select('slug, sector, bot_config_citas, modulos_activos, reserva_antelacion_min_horas, reserva_ventana_max_dias, reserva_max_personas').eq('client_id', cid).single(),
  ])

  const servicios: Servicio[] = ((srvRes.data ?? []) as Servicio[]).map(s => ({
    ...s, duracion_minutos: Number(s.duracion_minutos), precio: s.precio == null ? null : Number(s.precio),
  }))
  const srvPorId = new Map(servicios.map(s => [s.servicio_id, s]))

  const linkPorRecurso = new Map<string, string[]>()
  for (const row of (rsRes.data ?? []) as { recurso_id: string; servicio_id: string }[]) {
    const arr = linkPorRecurso.get(row.recurso_id) ?? []
    arr.push(row.servicio_id)
    linkPorRecurso.set(row.recurso_id, arr)
  }

  const horPorRecurso = new Map<string, RecursoHorario[]>()
  for (const row of (rhRes.data ?? []) as { recurso_id: string; dia_semana: number; hora_inicio: string; hora_fin: string }[]) {
    const arr = horPorRecurso.get(row.recurso_id) ?? []
    arr.push({ dia_semana: Number(row.dia_semana), hora_inicio: hhmm(row.hora_inicio), hora_fin: hhmm(row.hora_fin) })
    horPorRecurso.set(row.recurso_id, arr)
  }

  const recursos: Recurso[] = ((recRes.data ?? []) as { recurso_id: string; nombre: string; tipo: string | null; activo: boolean; empleado_id: string | null }[]).map(r => ({
    recurso_id:   r.recurso_id,
    nombre:       r.nombre,
    tipo:         r.tipo,
    activo:       r.activo,
    empleado_id:  r.empleado_id ?? null,
    servicio_ids: linkPorRecurso.get(r.recurso_id) ?? [],
    horarios:     (horPorRecurso.get(r.recurso_id) ?? []).sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio)),
  }))
  const recPorId = new Map(recursos.map(r => [r.recurso_id, r]))

  const citas: CitaConDetalle[] = ((citasRes.data ?? []) as Cita[]).map(c => {
    const srv = c.servicio_id ? srvPorId.get(c.servicio_id) : undefined
    return {
      ...c,
      recurso_nombre:    (c.recurso_id ? recPorId.get(c.recurso_id)?.nombre : undefined) ?? '—',
      servicio_nombre:   srv?.nombre ?? '—',
      servicio_duracion: srv?.duracion_minutos ?? 0,
    }
  })

  // RRHH (llenado rápido): si el módulo está activo, ofrecemos su lista de empleados
  // para importarlos como personal. Citas no depende de RRHH (sigue funcionando manual).
  const rrhh_activo = tieneModulo(cliRes.data?.modulos_activos, 'rrhh')
  let empleados: EmpleadoRRHH[] = []
  if (rrhh_activo) {
    const yaLinked = new Set(recursos.map(r => r.empleado_id).filter(Boolean) as string[])
    const { data: emps } = await db.from('empleados')
      .select('empleado_id, nombre, apellidos')
      .eq('client_id', cid).is('fecha_baja', null).order('nombre')
    empleados = ((emps ?? []) as { empleado_id: string; nombre: string; apellidos: string | null }[]).map(e => ({
      empleado_id:  e.empleado_id,
      nombre:       [e.nombre, e.apellidos].filter(Boolean).join(' '),
      ya_importado: yaLinked.has(e.empleado_id),
    }))
  }

  const { data: cierresData } = await db.from('reserva_cierres')
    .select('cierre_id, fecha_desde, fecha_hasta, motivo')
    .eq('client_id', cid).gte('fecha_hasta', hoy()).order('fecha_desde')

  return {
    client_id:   cid,
    citas,
    recursos,
    servicios,
    slug:        (cliRes.data?.slug as string) ?? null,
    etiquetas:   await etiquetasDeSector(db, (cliRes.data?.sector as string) ?? null),
    bot_config:  parseBotConfig(cliRes.data?.bot_config_citas),
    rrhh_activo,
    empleados,
    cierres:     (cierresData ?? []) as Cierre[],
    reglas:      reglasDe(cliRes.data as Record<string, unknown> | null),
  }
}

// ── Servicios (CRUD) ─────────────────────────────────────────────────────────

export async function guardarServicio(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const servicio_id = (formData.get('servicio_id') as string)?.trim()
  const nombre      = (formData.get('nombre')      as string)?.trim()
  const duracionRaw = parseInt(formData.get('duracion_minutos') as string, 10)
  const precioRaw   = (formData.get('precio') as string)?.trim()
  const activo      = formData.get('activo') === 'true'

  if (!nombre) return { ok: false, error: 'El nombre del servicio es obligatorio.' }
  const duracion = isNaN(duracionRaw) || duracionRaw < 5 ? 30 : duracionRaw
  const precio   = precioRaw ? Number(precioRaw) : null
  if (precio != null && (isNaN(precio) || precio < 0)) return { ok: false, error: 'Precio no válido.' }

  const db = createAdminClient()

  if (!servicio_id) {
    const { error } = await db.from('servicios').insert({
      servicio_id: generarServicioId(), client_id: session.client_id,
      nombre, duracion_minutos: duracion, precio, activo,
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('servicios')
      .update({ nombre, duracion_minutos: duracion, precio, activo, updated_at: new Date().toISOString() })
      .eq('servicio_id', servicio_id).eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function eliminarServicio(servicio_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const { count } = await db.from('reservas')
    .select('reserva_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id).eq('servicio_id', servicio_id)
    .gte('fecha', hoy()).in('estado', ['PENDIENTE', 'CONFIRMADA'])
  if ((count ?? 0) > 0) return { ok: false, error: 'El servicio tiene citas pendientes o confirmadas. Cancélalas antes de eliminarlo.' }

  await db.from('recurso_servicios').delete().eq('servicio_id', servicio_id)
  const { error } = await db.from('servicios').delete()
    .eq('servicio_id', servicio_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Recursos / profesionales (CRUD + servicios + horarios) ─────────────────────

export async function guardarRecurso(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const recurso_id  = (formData.get('recurso_id')  as string)?.trim()
  const nombre      = (formData.get('nombre')      as string)?.trim()
  const tipo        = (formData.get('tipo')        as string)?.trim() || null
  const empleado_id = (formData.get('empleado_id') as string)?.trim() || null
  const activo      = formData.get('activo') === 'true'

  if (!nombre) return { ok: false, error: 'El nombre es obligatorio.' }

  // Servicios que presta (sin selección = presta todos)
  const servicioIds = formData.getAll('servicio_ids').map(v => (v as string).trim()).filter(Boolean)

  // Horarios: campos hor_<dia>_inicio / hor_<dia>_fin (1..7); ambos rellenos = franja
  const horarios: { dia: number; inicio: string; fin: string }[] = []
  for (let d = 1; d <= 7; d++) {
    const ini = (formData.get(`hor_${d}_inicio`) as string)?.trim()
    const fin = (formData.get(`hor_${d}_fin`)    as string)?.trim()
    if (ini && fin) {
      if (ini >= fin) return { ok: false, error: 'En cada día la hora de fin debe ser posterior a la de inicio.' }
      horarios.push({ dia: d, inicio: ini, fin })
    }
  }

  const db = createAdminClient()
  const id = recurso_id || generarRecursoId()

  if (!recurso_id) {
    const { error } = await db.from('recursos').insert({ recurso_id: id, client_id: session.client_id, nombre, tipo, activo, empleado_id })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('recursos')
      .update({ nombre, tipo, activo, empleado_id, updated_at: new Date().toISOString() })
      .eq('recurso_id', id).eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  // Reemplazar servicios asignados
  await db.from('recurso_servicios').delete().eq('recurso_id', id)
  if (servicioIds.length > 0) {
    await db.from('recurso_servicios').insert(servicioIds.map(sid => ({ recurso_id: id, servicio_id: sid })))
  }

  // Reemplazar horarios
  await db.from('recurso_horarios').delete().eq('recurso_id', id).eq('client_id', session.client_id)
  if (horarios.length > 0) {
    await db.from('recurso_horarios').insert(horarios.map(h => ({
      horario_id: generarHorarioId(), recurso_id: id, client_id: session.client_id,
      dia_semana: h.dia, hora_inicio: h.inicio, hora_fin: h.fin,
    })))
  }

  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function eliminarRecurso(recurso_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const { count } = await db.from('reservas')
    .select('reserva_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id).eq('recurso_id', recurso_id)
    .gte('fecha', hoy()).in('estado', ['PENDIENTE', 'CONFIRMADA'])
  if ((count ?? 0) > 0) return { ok: false, error: 'Tiene citas pendientes o confirmadas. Cancélalas antes de eliminarlo.' }

  await db.from('recurso_servicios').delete().eq('recurso_id', recurso_id)
  await db.from('recurso_horarios').delete().eq('recurso_id', recurso_id).eq('client_id', session.client_id)
  const { error } = await db.from('recursos').delete()
    .eq('recurso_id', recurso_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Importar personal desde RRHH (llenado rápido; módulo independiente) ─────────

export async function importarPersonalRRHH(): Promise<{ ok: boolean; error?: string; importados?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  // Gating: solo si el negocio tiene el módulo RRHH contratado
  const { data: cli } = await db.from('clients').select('modulos_activos').eq('client_id', session.client_id).single()
  if (!tieneModulo(cli?.modulos_activos, 'rrhh')) return { ok: false, error: 'El módulo de RRHH no está activo.' }

  // Empleados activos (fecha_baja IS NULL) que aún no estén vinculados a un recurso
  const [{ data: emps }, { data: recs }] = await Promise.all([
    db.from('empleados').select('empleado_id, nombre, apellidos, cargo').eq('client_id', session.client_id).is('fecha_baja', null),
    db.from('recursos').select('empleado_id').eq('client_id', session.client_id).not('empleado_id', 'is', null),
  ])
  const yaLinked = new Set(((recs ?? []) as { empleado_id: string }[]).map(r => r.empleado_id))
  const nuevos = ((emps ?? []) as { empleado_id: string; nombre: string; apellidos: string | null; cargo: string | null }[])
    .filter(e => !yaLinked.has(e.empleado_id))

  if (nuevos.length === 0) return { ok: true, importados: 0 }

  const rows = nuevos.map(e => ({
    recurso_id:  generarRecursoId(),
    client_id:   session.client_id,
    nombre:      [e.nombre, e.apellidos].filter(Boolean).join(' '),
    tipo:        e.cargo ?? null,
    activo:      true,
    empleado_id: e.empleado_id,
  }))
  const { error } = await db.from('recursos').insert(rows)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/citas')
  return { ok: true, importados: nuevos.length }
}

// ── Crear cita (manual, desde el panel) ────────────────────────────────────────

export async function crearCitaManual(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const recurso_id     = (formData.get('recurso_id')     as string)?.trim()
  const servicio_id    = (formData.get('servicio_id')    as string)?.trim()
  const fecha          = (formData.get('fecha')          as string)?.trim()
  const horaRaw        = (formData.get('hora')           as string)?.trim()
  const nombre_cliente = (formData.get('nombre_cliente') as string)?.trim()
  const telefono       = (formData.get('telefono')       as string)?.trim() || null
  const notas          = (formData.get('notas')          as string)?.trim() || null

  if (!recurso_id)     return { ok: false, error: 'Selecciona un recurso o profesional.' }
  if (!servicio_id)    return { ok: false, error: 'Selecciona un servicio.' }
  if (!fecha)          return { ok: false, error: 'La fecha es obligatoria.' }
  if (!horaRaw)        return { ok: false, error: 'La hora es obligatoria.' }
  if (!nombre_cliente) return { ok: false, error: 'El nombre del cliente es obligatorio.' }
  if (fecha < hoy())   return { ok: false, error: 'No se puede crear una cita en una fecha pasada.' }
  if (fecha === hoy() && horaRaw <= horaAhora()) return { ok: false, error: 'Esa hora ya pasó. Elige una hora futura.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('bot_config_citas, nombre_empresa').eq('client_id', session.client_id).single()
  const bot = parseBotConfig(cli?.bot_config_citas)
  const reservaId = generarReservaId()

  const { data, error } = await db.rpc('res_crear_cita', {
    p_client_id: session.client_id, p_recurso_id: recurso_id, p_servicio_id: servicio_id,
    p_fecha: fecha, p_hora: horaRaw, p_nombre_cliente: nombre_cliente, p_telefono: telefono, p_notas: notas,
    p_canal: 'manual', p_confirmacion_automatica: bot.confirmacion_automatica, p_reserva_id: reservaId,
  })
  if (error) return { ok: false, error: error.message }
  const result = data as { ok: boolean; error?: string }
  if (!result.ok) return { ok: false, error: result.error ?? 'Error al crear la cita.' }

  await notificarReservaNueva(
    { token: bot.token, activo: bot.activo, notificar_owner_chat_id: bot.notificar_owner_chat_id },
    { reserva_id: reservaId, fecha, hora: horaRaw, personas: 1, nombre_cliente, telefono, notas,
      estado: bot.confirmacion_automatica ? 'CONFIRMADA' : 'PENDIENTE', telegram_chat_id: null },
    (cli?.nombre_empresa as string) ?? 'Tu negocio',
  )

  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Cambiar estado de una cita ─────────────────────────────────────────────────

export async function cambiarEstadoCita(reserva_id: string, nuevoEstado: EstadoReserva): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('bot_config_citas, nombre_empresa').eq('client_id', session.client_id).single()
  const bot = parseBotConfig(cli?.bot_config_citas)

  const r = await transicionarEstado(
    db, session.client_id, reserva_id, nuevoEstado,
    (cli?.nombre_empresa as string) ?? 'Tu cita',
    { token: bot.token, activo: bot.activo },
  )
  if (!r.ok) return r

  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Público: datos de la mini-web de citas ─────────────────────────────────────

export interface ServicioPublico {
  servicio_id: string
  nombre: string
  duracion_minutos: number
  precio: number | null
}
export interface RecursoPublico {
  recurso_id: string
  nombre: string
  servicio_ids: string[]
}
export interface SlotCita {
  recurso_id: string
  recurso_nombre: string
  hora: string  // HH:MM
}
export interface DiaDisponible {
  fecha:        string  // YYYY-MM-DD
  primera_hora: string  // HH:MM — primer hueco del día
  huecos:       number  // nº de horas libres ese día
}

export async function obtenerCitasPublicas(slug: string): Promise<{
  negocio: { nombre: string } | null
  servicios: ServicioPublico[]
  recursos:  RecursoPublico[]
  etiquetas: EtiquetasSector
  client_id: string | null
  reglas:    ReglasReserva
}> {
  const db = createAdminClient()

  const { data: cli } = await db.from('clients')
    .select('client_id, nombre_empresa, sector, modulos_activos, reserva_antelacion_min_horas, reserva_ventana_max_dias, reserva_max_personas')
    .eq('slug', slug).single()

  if (!cli) return { negocio: null, servicios: [], recursos: [], etiquetas: { ...ETIQUETAS_DEFAULT }, client_id: null, reglas: reglasDe(null) }

  // Gating: el negocio debe tener la funcionalidad de citas contratada
  const modulos = Array.isArray(cli.modulos_activos) ? cli.modulos_activos as string[] : []
  if (!modulos.includes('agenda')) {
    return { negocio: null, servicios: [], recursos: [], etiquetas: { ...ETIQUETAS_DEFAULT }, client_id: null, reglas: reglasDe(null) }
  }

  const [srvRes, recRes, rsRes] = await Promise.all([
    db.from('servicios').select('servicio_id, nombre, duracion_minutos, precio').eq('client_id', cli.client_id).eq('activo', true).order('nombre'),
    db.from('recursos').select('recurso_id, nombre').eq('client_id', cli.client_id).eq('activo', true).order('nombre'),
    db.from('recurso_servicios').select('recurso_id, servicio_id'),
  ])

  const linkPorRecurso = new Map<string, string[]>()
  for (const row of (rsRes.data ?? []) as { recurso_id: string; servicio_id: string }[]) {
    const arr = linkPorRecurso.get(row.recurso_id) ?? []
    arr.push(row.servicio_id); linkPorRecurso.set(row.recurso_id, arr)
  }

  return {
    negocio:   { nombre: cli.nombre_empresa },
    servicios: ((srvRes.data ?? []) as ServicioPublico[]).map(s => ({ ...s, duracion_minutos: Number(s.duracion_minutos), precio: s.precio == null ? null : Number(s.precio) })),
    recursos:  ((recRes.data ?? []) as { recurso_id: string; nombre: string }[]).map(r => ({ recurso_id: r.recurso_id, nombre: r.nombre, servicio_ids: linkPorRecurso.get(r.recurso_id) ?? [] })),
    etiquetas: await etiquetasDeSector(db, (cli.sector as string) ?? null),
    client_id: cli.client_id,
    reglas:    reglasDe(cli as Record<string, unknown>),
  }
}

export async function obtenerSlotsCita(
  client_id: string, servicio_id: string, recurso_id: string | null, fecha: string,
): Promise<SlotCita[]> {
  if (!await rateLimitOk('slots_cita', 90, 60)) return []
  const db = createAdminClient()
  const { data, error } = await db.rpc('res_slots_cita', {
    p_client_id: client_id, p_servicio_id: servicio_id, p_recurso_id: recurso_id, p_fecha: fecha,
  })
  if (error || !Array.isArray(data)) return []
  return data as SlotCita[]
}

// Próximos días con hueco para un servicio (+recurso opcional). Una sola llamada
// devuelve hasta ~10 días disponibles, para saltar al primero y pintar la tira
// de fechas — el cliente no adivina cuándo hay sitio.
export async function obtenerDiasDisponiblesCita(
  client_id: string, servicio_id: string, recurso_id: string | null, desde?: string,
): Promise<DiaDisponible[]> {
  if (!await rateLimitOk('dias_cita', 60, 60)) return []
  const db = createAdminClient()
  const { data, error } = await db.rpc('res_dias_disponibles_cita', {
    p_client_id: client_id, p_servicio_id: servicio_id, p_recurso_id: recurso_id,
    p_desde: desde ?? hoy(), p_max_dias: 30,
  })
  if (error || !Array.isArray(data)) return []
  return data as DiaDisponible[]
}

export async function crearCitaPublica(formData: FormData): Promise<{ ok: boolean; error?: string; token?: string; estado?: EstadoReserva }> {
  // Honeypot: campo oculto que solo rellenan los bots → fingir éxito sin crear nada
  if ((formData.get('hp') as string)?.trim()) return { ok: true }

  // Rate limit por IP (anti-spam de citas)
  if (!await rateLimitOk('cita_crear', 5, 300)) {
    return { ok: false, error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }
  }

  const client_id      = (formData.get('client_id')   as string)?.trim()
  const servicio_id    = (formData.get('servicio_id') as string)?.trim()
  const recurso_id     = (formData.get('recurso_id')  as string)?.trim()
  const fecha          = (formData.get('fecha')       as string)?.trim()
  const hora           = (formData.get('hora')        as string)?.trim()
  const nombre_cliente = (formData.get('nombre')      as string)?.trim()
  const telefono       = (formData.get('telefono')    as string)?.trim() || null
  const email          = (formData.get('email')       as string)?.trim() || ''
  const notas          = (formData.get('notas')       as string)?.trim() || null

  if (!client_id)      return { ok: false, error: 'Negocio no identificado.' }
  if (!servicio_id)    return { ok: false, error: 'Selecciona un servicio.' }
  if (!recurso_id)     return { ok: false, error: 'Selecciona un horario.' }
  if (!fecha)          return { ok: false, error: 'Fecha obligatoria.' }
  if (!hora)           return { ok: false, error: 'Hora obligatoria.' }
  if (!nombre_cliente) return { ok: false, error: 'Nombre obligatorio.' }
  if (!email)          return { ok: false, error: 'Correo obligatorio.' }
  if (!emailValido(email)) return { ok: false, error: 'Correo no válido.' }
  if (fecha < hoy())   return { ok: false, error: 'No se puede reservar en una fecha pasada.' }
  if (fecha === hoy() && hora <= horaAhora()) return { ok: false, error: 'Esa hora ya pasó. Elige otra.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('bot_config_citas, nombre_empresa, modulos_activos').eq('client_id', client_id).single()
  const modulos = Array.isArray(cli?.modulos_activos) ? cli!.modulos_activos as string[] : []
  if (!modulos.includes('agenda')) return { ok: false, error: 'Este negocio no acepta citas en línea.' }

  const bot = parseBotConfig(cli?.bot_config_citas)
  const reservaId = generarReservaId()

  const { data, error } = await db.rpc('res_crear_cita', {
    p_client_id: client_id, p_recurso_id: recurso_id, p_servicio_id: servicio_id,
    p_fecha: fecha, p_hora: hora, p_nombre_cliente: nombre_cliente, p_telefono: telefono, p_notas: notas,
    p_canal: 'web', p_confirmacion_automatica: bot.confirmacion_automatica, p_reserva_id: reservaId,
  })
  if (error) return { ok: false, error: error.message }
  const result = data as { ok: boolean; error?: string }
  if (!result.ok) return { ok: false, error: result.error ?? 'Error al reservar la cita.' }

  // Correo del cliente: se guarda tras la inserción atómica (no es columna de la RPC).
  await db.from('reservas').update({ email }).eq('reserva_id', reservaId)

  await notificarReservaNueva(
    { token: bot.token, activo: bot.activo, notificar_owner_chat_id: bot.notificar_owner_chat_id },
    { reserva_id: reservaId, fecha, hora, personas: 1, nombre_cliente, telefono, notas,
      estado: bot.confirmacion_automatica ? 'CONFIRMADA' : 'PENDIENTE', telegram_chat_id: null },
    (cli?.nombre_empresa as string) ?? 'Tu negocio',
  )

  // Token público para que el cliente pueda gestionar/cancelar su cita
  const { data: tk } = await db.from('reservas').select('token').eq('reserva_id', reservaId).single()

  return {
    ok: true,
    token: (tk?.token as string) ?? undefined,
    estado: bot.confirmacion_automatica ? 'CONFIRMADA' : 'PENDIENTE',
  }
}

// ── Bot de Telegram de Citas (independiente del de Reservas) ───────────────────

export async function guardarBotConfigCitas(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const r = await guardarBotConfigCol(createAdminClient(), session.client_id, 'bot_config_citas', {
    token:                  (formData.get('token')  as string)?.trim() || null,
    nombre:                 (formData.get('nombre') as string)?.trim() || null,
    activo:                 formData.get('activo') === 'true',
    confirmacionAutomatica: formData.get('confirmacion_automatica') === 'true',
  })
  if (!r.ok) return r
  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function guardarConfirmacionCitas(activa: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const r = await guardarConfirmacionCol(createAdminClient(), session.client_id, 'bot_config_citas', activa)
  if (!r.ok) return r
  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function toggleActivoBotCitas(activo: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const r = await toggleActivoBotCol(createAdminClient(), session.client_id, 'bot_config_citas', activo)
  if (!r.ok) return r
  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function eliminarBotConfigCitas(): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const r = await eliminarBotConfigCol(createAdminClient(), session.client_id, 'bot_config_citas')
  if (!r.ok) return r
  revalidatePath('/portal/citas')
  return { ok: true }
}
