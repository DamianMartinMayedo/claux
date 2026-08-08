'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { hoyEnTz, ahoraEnTz } from '@/lib/fecha-tz'
import { transicionarEstado, notificarReservaNueva, CAMBIOS_VALIDOS, type EstadoReserva } from '@/lib/reservas/estado'
import { notificarReservaEntrante, notificarCancelacionCliente } from '@/lib/notificaciones/eventos'
import { type BotConfig, parseBotConfig, guardarBotConfigCol, toggleActivoBotCol, eliminarBotConfigCol, guardarConfirmacionCol, guardarIaActivaCol } from '@/lib/reservas/bot-config'
import { tieneModulo } from '@/lib/modulos'
import { etiquetasCliente } from '@/lib/sector'
import { enviarMensaje } from '@/lib/telegram/enviar'
import { rateLimitOk } from '@/lib/rate-limit'
import { getPortalSession, puedeEditarModulo }  from './auth'
// El slug, los cierres y las reglas son del NEGOCIO, no de esta funcionalidad: viven
// en `agenda-comun.ts` con el candado «Reservas o Citas». Aquí solo se usan sus tipos.
import type { Cierre, ReglasReserva, ResultadoAgenda } from './agenda-comun'
import {
  limiteDelFiltro, patronBusqueda, ordenDelRango, type FiltroListado,
} from '@/lib/listados'
import { sumarDias } from '@/lib/fecha-tz'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type CanalReserva   = 'web' | 'bot' | 'manual'

export interface ReservaFranja {
  franja_id:        string
  client_id:        string
  nombre:           string
  hora_inicio:      string | null
  hora_fin:         string | null
  capacidad:        number
  /** Tope de RESERVAS a la vez (no de personas). 0 = sin tope. 40 plazas no son 10 mesas de 4. */
  max_reservas:     number
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
  /** La metió el dueño saltándose una regla (aforo, cierre, antelación…). */
  forzada:                 boolean
  /** ATENDIDA la puso el barrido diario, no el dueño. Se dice en pantalla. */
  cierre_auto:             boolean
  created_at:              string
  updated_at:              string
}

export interface ReservaConFranja extends Reserva {
  franja_nombre:      string
  franja_hora_inicio: string | null
  franja_hora_fin:    string | null
}

export interface ReservaPageData {
  client_id:  string
  /** Nombre del negocio: se usa para redactar el aviso al cliente (fase 10). */
  negocio:    string
  /**
   * Cómo llama el negocio a esto («Reservas», «Turnos», «Clases»). El `<h1>` estaba
   * a fuego, así que el menú podía decir una palabra y la página otra.
   */
  etiqueta_reservas: string
  reservas:   ReservaConFranja[]
  franjas:    ReservaFranja[]
  bot_config: BotConfig
  slug:       string | null
  cierres:    Cierre[]
  reglas:     ReglasReserva
  tieneIa:    boolean   // addon asistente_ia contratado → se ofrece el toggle de IA del bot
  /**
   * Tiene TAMBIÉN Citas contratado. Solo entonces se dice de cada ajuste si es de
   * esta funcionalidad o del negocio entero: con una sola, esa línea es ruido.
   */
  tieneAmbas: boolean
  /** Rango aplicado EN LA CONSULTA. Viaja a la vista para pintar el botón de rango. */
  rango:      { desde: string; hasta: string }
  /** Texto buscado, aplicado en la consulta. */
  q:          string
  /** El techo recortó: hay reservas del rango que no se han traído. */
  hay_mas:    boolean
  /** Cuántas cumplen el filtro DE VERDAD (`count: 'exact'`). */
  total:      number
  /** Techo con el que se consultó, para que «Ver más» sepa desde dónde subir. */
  limite:     number
  /**
   * Lo de HOY, contado aparte (U3). La cabecera se calculaba sobre `reservas`, que es
   * el rango cargado: cambiar el rango a «Mes pasado» la dejaba en cero, como si el
   * negocio no tuviera nada hoy.
   */
  hoy:        { pendientes: number; confirmadas: number; total: number }
  /**
   * Confirmadas de días que ya pasaron y que nadie ha cerrado: ni «vino» ni «no vino».
   * El barrido las cierra solo a los 7 días (`DIAS_CIERRE_AUTO`), pero mientras tanto
   * solo el dueño lo sabe — y con el rango por defecto (hoy → +30) no las ve nunca.
   */
  por_cerrar: number
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

// ── Obtener datos de Reservas ─────────────────────────────────────────────────

/**
 * Rango por defecto de Reservas: **los próximos 30 días**.
 *
 * Una reserva es un documento de FUTURO —lo que hay que atender—, así que el defecto no
 * puede ser «los últimos 3 meses» como en los listados de Contabilidad. Y tiene que ser un
 * rango de verdad: la pantalla traía la historia ENTERA de reservas y luego escondía todo
 * salvo el día de hoy en el navegador, así que un negocio con dos años de reservas pagaba
 * miles de filas en 3G para enseñar ocho.
 */
function rangoPorDefecto(): { desde: string; hasta: string } {
  const hoyIso = hoyEnTz()
  return { desde: hoyIso, hasta: sumarDias(hoyIso, 30) }
}

export async function obtenerReservas(filtro?: FiltroListado): Promise<ReservaPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const porDefecto = rangoPorDefecto()
  const desde  = filtro?.desde ?? porDefecto.desde
  const hasta  = filtro?.hasta ?? porDefecto.hasta
  const q      = (filtro?.q ?? '').trim()
  const limite = limiteDelFiltro(filtro)
  const patron = patronBusqueda(q)

  // `count: 'exact'` en la MISMA consulta: devuelve las filas del techo y, aparte, cuántas
  // cumplen el filtro. Sin él no hay forma de decir cuántas faltan, y el aviso del techo
  // acabaría diciendo «500 de 500» sobre el conjunto ya recortado.
  //
  // Solo reservas (franja); las citas viven en la misma tabla con recurso_id — se excluyen
  // aquí para que no aparezcan en la lista de Reservas.
  let resQuery = db.from('reservas').select('*', { count: 'exact' })
    .eq('client_id', session.client_id)
    .is('recurso_id', null)
  // Los filtros de la barra, cuando la vista los ESCALA (`?srv=1`): mientras el listado cabe
  // entero el navegador los aplica al instante y da el mismo resultado; en cuanto hay filas
  // sin traer tienen que aplicarse aquí, o filtrar por estado solo miraría las 500 más
  // recientes del conjunto sin decirlo.
  if (filtro?.estado)    resQuery = resQuery.eq('estado', filtro.estado)
  if (filtro?.categoria) resQuery = resQuery.eq('franja_id', filtro.categoria)
  if (desde) resQuery = resQuery.gte('fecha', desde)
  if (hasta) resQuery = resQuery.lte('fecha', hasta)
  if (patron) {
    resQuery = resQuery.or([
      `nombre_cliente.ilike.${patron}`,
      `telefono.ilike.${patron}`,
      `notas.ilike.${patron}`,
    ].join(','))
  }
  // El orden sigue al rango: mirando al futuro, lo primero que hay que atender arriba
  // (y dentro del día, por hora); mirando a un histórico, lo más reciente primero.
  const { ascendente } = ordenDelRango(desde, hasta)
  resQuery = resQuery
    .order('fecha', { ascending: ascendente })
    .order('hora',  { ascending: ascendente, nullsFirst: ascendente })
    .order('created_at', { ascending: ascendente })
    .limit(limite)

  // Lo de hoy, contado en la base y no sobre las filas traídas: la cabecera no puede
  // depender del rango que el dueño tenga puesto en la barra.
  const deHoy = (estado: EstadoReserva) => db.from('reservas')
    .select('reserva_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id).is('recurso_id', null)
    .eq('fecha', hoy()).eq('estado', estado)

  const [franRes, resRes, cliRes, pendHoy, confHoy, porCerrar] = await Promise.all([
    db.from('reserva_franjas').select('*')
      .eq('client_id', session.client_id)
      .order('hora_inicio', { ascending: true, nullsFirst: true }),
    resQuery,
    db.from('clients').select('bot_config, slug, nombre_empresa, sector, etiquetas, modulos_activos, reserva_antelacion_min_horas, reserva_ventana_max_dias, reserva_max_personas')
      .eq('client_id', session.client_id)
      .single(),
    deHoy('PENDIENTE'),
    deHoy('CONFIRMADA'),
    db.from('reservas').select('reserva_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id).is('recurso_id', null)
      .eq('estado', 'CONFIRMADA').lt('fecha', hoy()),
  ])

  const franjas  = ((franRes.data ?? []) as ReservaFranja[]).map(f => ({
    ...f,
    capacidad:        Number(f.capacidad),
    max_reservas:     Number(f.max_reservas ?? 0),
    duracion_minutos: Number(f.duracion_minutos),
  }))
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

  // Cascada completa: override del cliente → sector → genérico (la misma del sidebar).
  const { data: plantilla } = cliRes.data?.sector
    ? await db.from('plantillas_sector').select('etiquetas').eq('sector', cliRes.data.sector as string).maybeSingle()
    : { data: null }
  const etiquetas = etiquetasCliente(plantilla?.etiquetas, cliRes.data?.etiquetas)

  return {
    client_id: session.client_id,
    negocio:  (cliRes.data?.nombre_empresa as string) ?? 'Tu negocio',
    etiqueta_reservas: etiquetas.reservas,
    reservas, franjas, bot_config, slug,
    cierres, reglas, tieneIa,
    tieneAmbas: tieneModulo(cliRes.data?.modulos_activos, 'agenda'),
    rango:   { desde, hasta },
    q,
    hay_mas: reservas.length >= limite,
    total:   resRes.count ?? reservas.length,
    limite,
    hoy: {
      pendientes:  pendHoy.count ?? 0,
      confirmadas: confHoy.count ?? 0,
      total:      (pendHoy.count ?? 0) + (confHoy.count ?? 0),
    },
    por_cerrar: porCerrar.count ?? 0,
  }
}

// ── Crear reserva (manual, desde el panel) ────────────────────────────────────

/**
 * Alta manual. `forzar` solo puede llegar de aquí: el alta pública y los bots llaman
 * siempre sin él. Cuando el dueño fuerza, la RPC mete la reserva y devuelve en
 * `avisos` lo que se ha saltado — el sistema avisa, no bloquea (misma filosofía que
 * el `permitir_negativo` del TPV).
 */
export async function crearReserva(
  formData: FormData,
  forzar = false,
): Promise<ResultadoAgenda> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('reservas_citas'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  // RES-4: la hora era opcional y caía a las 12:00 en silencio. Una reserva de mesa
  // sin hora no es una reserva; que la eligiera el software era un dato inventado.
  if (!horaRaw)         return { ok: false, error: 'La hora es obligatoria.' }

  const personas = isNaN(personasRaw) || personasRaw < 1 ? 1 : personasRaw
  const hora     = horaRaw

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
    p_forzar:                  forzar,
  })

  if (error) return { ok: false, error: error.message }
  const result = data as ResultadoAgenda
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Error al crear la reserva.', forzable: result.forzable }
  }

  revalidatePath('/portal/reservas')
  return { ok: true, avisos: result.avisos ?? [] }
}

// ── Modificar reserva ─────────────────────────────────────────────────────────

export async function modificarReserva(
  reserva_id: string,
  formData: FormData,
  forzar = false,
): Promise<ResultadoAgenda> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('reservas_citas'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!horaRaw)         return { ok: false, error: 'La hora es obligatoria.' }

  const db       = createAdminClient()
  const personas = isNaN(personasRaw) || personasRaw < 1 ? 1 : personasRaw
  const hora     = horaRaw

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
    p_forzar:         forzar,
  })

  if (error) return { ok: false, error: error.message }
  const result = data as ResultadoAgenda
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Error al modificar la reserva.', forzable: result.forzable }
  }

  revalidatePath('/portal/reservas')
  return { ok: true, avisos: result.avisos ?? [] }
}

// ── Cambiar estado de una reserva ─────────────────────────────────────────────

export async function cambiarEstadoReserva(
  reserva_id: string,
  nuevoEstado: EstadoReserva,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('reservas_citas'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
    { token: botCfg.token, activo: botCfg.activo, clientId: session.client_id, columna: 'bot_config' },
  )
  if (!r.ok) return r

  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── Cambiar estado en lote (Fase 2) ───────────────────────────────────────────
// Candado `reservas_citas` inline. SECUENCIAL: cada reserva reutiliza la acción
// individual, que valida la transición y AVISA al cliente por Telegram si procede.
// Elegibilidad por la máquina de estados (CAMBIOS_VALIDOS); lo inválido se omite.

export interface ResultadoLote {
  hechas:   number
  omitidas: { etiqueta: string; motivo: string }[]
  errores:  { etiqueta: string; error: string }[]
  error?:   string
}
const loteVacio = (error?: string): ResultadoLote => ({ hechas: 0, omitidas: [], errores: [], error })

export async function cambiarEstadoReservasEnLote(
  ids: string[], nuevoEstado: EstadoReserva,
): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('reservas_citas'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const db = createAdminClient()
  const { data: rows } = await db.from('reservas')
    .select('reserva_id, estado, nombre_cliente')
    .eq('client_id', session.client_id).in('reserva_id', ids)

  const res = loteVacio()
  for (const row of (rows ?? []) as { reserva_id: string; estado: EstadoReserva; nombre_cliente: string }[]) {
    const etiqueta = row.nombre_cliente || row.reserva_id
    if (!CAMBIOS_VALIDOS[row.estado]?.includes(nuevoEstado)) {
      res.omitidas.push({ etiqueta, motivo: `no se puede pasar de ${row.estado} a ${nuevoEstado}` }); continue
    }
    const r = await cambiarEstadoReserva(row.reserva_id, nuevoEstado)   // secuencial: avisa por Telegram
    if (r.ok) res.hechas++
    else res.errores.push({ etiqueta, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/reservas')
  return res
}

// ── Guardar franja (crear / editar) ───────────────────────────────────────────

export async function guardarFranja(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('reservas_citas'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const franja_id      = (formData.get('franja_id')      as string)?.trim()
  const nombre         = (formData.get('nombre')         as string)?.trim()
  const hora_inicio    = (formData.get('hora_inicio')    as string)?.trim()
  const hora_fin       = (formData.get('hora_fin')       as string)?.trim()
  const capacidadRaw   = parseInt(formData.get('capacidad') as string, 10)
  const duracionRaw    = parseInt(formData.get('duracion_minutos') as string, 10)
  const maxResRaw      = parseInt(formData.get('max_reservas') as string, 10)
  // RES-1: la casilla no existía, así que un turno solo se podía ELIMINAR — y eliminar
  // está bloqueado si tiene reservas futuras. Callejón sin salida, con un badge
  // «Activo/Inactivo» en la tabla que por tanto siempre decía Activo.
  const activa = formData.get('activa') === 'on' || formData.get('activa') === 'true'

  if (!nombre)      return { ok: false, error: 'El nombre del turno es obligatorio.' }
  if (!hora_inicio) return { ok: false, error: 'La hora de inicio es obligatoria.' }
  if (!hora_fin)    return { ok: false, error: 'La hora de fin es obligatoria.' }
  if (hora_inicio >= hora_fin) return { ok: false, error: 'La hora de fin debe ser posterior a la de inicio.' }
  const capacidad  = isNaN(capacidadRaw) || capacidadRaw < 1 ? 1 : capacidadRaw
  const duracion   = isNaN(duracionRaw)  || duracionRaw  < 15 ? 60 : duracionRaw
  // 0 = sin tope, como el resto de reglas del módulo.
  const max_reservas = isNaN(maxResRaw) || maxResRaw < 0 ? 0 : maxResRaw

  // dias_semana: array de checkboxes (1-7)
  const diasRaw = formData.getAll('dias_semana').map(v => parseInt(v as string, 10)).filter(d => d >= 1 && d <= 7)
  const dias_semana = diasRaw.length > 0 ? diasRaw : null

  const db = createAdminClient()

  // RES-2: dos turnos solapan solo si además COMPARTEN algún día. La consulta cruzaba
  // únicamente las horas —pese a que su comentario decía lo contrario—, así que
  // «Almuerzo Lun-Vie 12-16» rechazaba «Brunch Sáb-Dom 12-16», que no se pisan nunca.
  // `dias_semana = null` significa TODOS los días, así que un null choca con cualquiera.
  const solapeQuery = db.from('reserva_franjas')
    .select('franja_id, nombre, dias_semana')
    .eq('client_id', session.client_id)
    .eq('activa', true)
    .lt('hora_inicio', hora_fin)
    .gt('hora_fin', hora_inicio)
  if (franja_id) solapeQuery.neq('franja_id', franja_id)
  const { data: solapadas } = await solapeQuery
  const choque = (solapadas ?? []).find((f: { dias_semana: number[] | null }) => {
    const otros = f.dias_semana
    if (!dias_semana || !otros || otros.length === 0) return true      // alguno vale para todos los días
    return otros.some(d => dias_semana.includes(d))
  })
  if (choque) {
    return { ok: false, error: `El horario se solapa con «${choque.nombre}» en algún día. Ajusta las horas o los días.` }
  }

  if (!franja_id) {
    const { error } = await db.from('reserva_franjas').insert({
      franja_id: generarFranjaId(),
      client_id: session.client_id,
      nombre,
      hora_inicio,
      hora_fin,
      capacidad,
      max_reservas,
      duracion_minutos: duracion,
      dias_semana,
      activa,
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('reserva_franjas')
      .update({ nombre, hora_inicio, hora_fin, capacidad, max_reservas, duracion_minutos: duracion, dias_semana, activa, updated_at: new Date().toISOString() })
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
  if (!(await puedeEditarModulo('reservas_citas'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!(await puedeEditarModulo('reservas_citas'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!(await puedeEditarModulo('reservas_citas'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!(await puedeEditarModulo('reservas_citas'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const r = await toggleActivoBotCol(createAdminClient(), session.client_id, 'bot_config', activo)
  if (!r.ok) return r
  revalidatePath('/portal/reservas')
  return { ok: true }
}

// ── IA del bot (requiere addon asistente_ia) ───────────────────────────────────

export async function toggleIaBotReservas(activa: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('reservas_citas'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!(await puedeEditarModulo('reservas_citas'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const r = await eliminarBotConfigCol(createAdminClient(), session.client_id, 'bot_config')
  if (!r.ok) return r
  revalidatePath('/portal/reservas')
  return { ok: true }
}

// El slug, los cierres/festivos y las reglas de reserva se guardan desde
// `agenda-comun.ts`: son del negocio y los comparten Reservas y Citas.

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
  // Decisión 1 del plan: sin correo al cliente final, pedir el correo como obligatorio
  // era pedir un dato para un canal que no existe. El TELÉFONO sí es obligatorio —el
  // formulario ya lo exigía, pero la acción lo aceptaba null, que es el que cuenta.
  if (!telefono)        return { ok: false, error: 'Teléfono obligatorio.' }
  if (email && !emailValido(email)) return { ok: false, error: 'Correo no válido.' }

  const personas = isNaN(personasRaw) || personasRaw < 1 ? 1 : personasRaw
  const horaVal  = hora || '12:00:00'

  if (fecha === hoy() && horaVal <= horaAhora()) return { ok: false, error: 'Esa hora ya pasó. Elige una hora futura.' }

  const db = createAdminClient()

  // Confirmación automática + datos para notificar al dueño
  const { data: cliente } = await db.from('clients')
    .select('bot_config, nombre_empresa, modulos_activos')
    .eq('client_id', client_id)
    .single()

  // Gating del tenant: un POST directo saltaría la página (que ya lo comprueba en
  // obtenerReservasPublicas). Sin el módulo, el negocio no acepta reservas.
  const modulos = Array.isArray(cliente?.modulos_activos) ? cliente!.modulos_activos as string[] : []
  if (!modulos.includes('reservas_citas')) return { ok: false, error: 'Este negocio no acepta reservas en línea.' }

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
    { token: botCfg.token, activo: botCfg.activo, notificar_owner_chat_id: botCfg.notificar_owner_chat_id,
      clientId: client_id, columna: 'bot_config' },
    {
      reserva_id: reservaId, fecha, hora: horaVal, personas,
      nombre_cliente, telefono, notas,
      estado: botCfg.confirmacion_automatica ? 'CONFIRMADA' : 'PENDIENTE',
      telegram_chat_id: null,
    },
    (cliente?.nombre_empresa as string) ?? 'Tu negocio',
  )

  // Bandeja interna del portal (además del aviso de Telegram, que exige bot).
  await notificarReservaEntrante({
    clientId: client_id, reservaId: reservaId, modo: 'reserva',
    nombreCliente: nombre_cliente, fecha, hora: horaVal,
    detalle: `${personas} persona${personas === 1 ? '' : 's'}`,
    pendiente: !botCfg.confirmacion_automatica,
  })

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
  /** Logo del negocio (COM-5): el enlace compartido es SUYO, no de CLAUX. */
  logo_url: string | null
}

export async function obtenerReservasPublicas(slug: string): Promise<{
  negocio:  NegocioPublico | null
  franjas:  FranjaPublica[]
  client_id: string | null
  reglas:   ReglasReserva
}> {
  const db = createAdminClient()

  const { data: cliente } = await db.from('clients')
    .select('client_id, nombre_empresa, slug, modulos_activos, reserva_antelacion_min_horas, reserva_ventana_max_dias, reserva_max_personas')
    .eq('slug', slug)
    .single()

  if (!cliente) return { negocio: null, franjas: [], client_id: null, reglas: { ...REGLAS_DEFAULT } }


  // Gating: el negocio debe tener las reservas contratadas. Si no, se devuelve
  // vacío → la página pública hace notFound() (mismo criterio que las citas).
  const modulos = Array.isArray(cliente.modulos_activos) ? cliente.modulos_activos as string[] : []
  if (!modulos.includes('reservas_citas')) return { negocio: null, franjas: [], client_id: null, reglas: { ...REGLAS_DEFAULT } }

  const [{ data: franjas }, { data: empresa }] = await Promise.all([
    db.from('reserva_franjas')
      .select('franja_id, nombre, hora_inicio, hora_fin, capacidad, duracion_minutos, dias_semana')
      .eq('client_id', cliente.client_id)
      .eq('activa', true)
      .order('hora_inicio', { ascending: true, nullsFirst: true }),
    // Mismo criterio que el catálogo: el logo solo si el negocio lo tiene activado.
    db.from('empresas').select('logo_url, mostrar_logo').eq('client_id', cliente.client_id).limit(1).maybeSingle(),
  ])
  const logo = empresa?.mostrar_logo ? ((empresa?.logo_url as string | null) ?? null) : null

  return {
    negocio:  { nombre: cliente.nombre_empresa as string, slug: cliente.slug as string | null, logo_url: logo },
    franjas:  ((franjas ?? []) as FranjaPublica[]).map(f => ({ ...f, capacidad: Number(f.capacidad), duracion_minutos: Number(f.duracion_minutos) })),
    client_id: cliente.client_id,
    reglas:   parseReglas(cliente as Record<string, unknown>),
  }
}

export interface Disponibilidad {
  disponibles: number
  capacidad:   number
  /** Reservas vivas en ese solape: el otro tope (`max_reservas`), no las personas. */
  reservas:    number
  max_reservas: number
}

const SIN_HUECO: Disponibilidad = { disponibles: 0, capacidad: 0, reservas: 0, max_reservas: 0 }

// El cálculo, una sola vez. Lo usan la mini-web pública (con rate-limit) y el panel
// (con sesión): la misma cuenta contada dos veces acaba dando dos respuestas.
async function calcularDisponibilidad(
  db: ReturnType<typeof createAdminClient>,
  client_id: string, franja_id: string, fecha: string, hora?: string,
): Promise<Disponibilidad> {
  // Negocio cerrado ese día (festivo/cierre) → sin disponibilidad
  const { data: cerr } = await db.from('reserva_cierres').select('cierre_id')
    .eq('client_id', client_id).lte('fecha_desde', fecha).gte('fecha_hasta', fecha).limit(1)
  if (cerr && cerr.length > 0) return { ...SIN_HUECO }

  const { data: franja } = await db.from('reserva_franjas')
    .select('capacidad, duracion_minutos, max_reservas')
    .eq('franja_id', franja_id)
    .eq('client_id', client_id)
    .single()

  if (!franja) return { ...SIN_HUECO }

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

  const filas    = ocupantes ?? []
  const ocupado  = filas.reduce((s: number, r: { personas: number }) => s + Number(r.personas), 0)
  const capacidad = Number(franja.capacidad)
  return {
    disponibles:  Math.max(0, capacidad - ocupado),
    capacidad,
    reservas:     filas.length,
    max_reservas: Number(franja.max_reservas ?? 0),
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
  const { disponibles } = await calcularDisponibilidad(createAdminClient(), client_id, franja_id, fecha, hora)
  return { disponibles }
}

/**
 * La misma disponibilidad, para el PANEL (RES-3).
 *
 * El alta manual usaba `obtenerDisponibilidadPublica`, o sea el endpoint anti-scraping
 * con límite por IP: el dueño gastaba el cupo de sus propios clientes solo por abrir el
 * formulario. Aquí el candado es la sesión, el `client_id` sale de ella —no del
 * navegador— y devuelve además los dos topes, para poder decir «12 de 40 · 3 reservas».
 */
export async function obtenerDisponibilidadPortal(
  franja_id: string, fecha: string, hora?: string,
): Promise<Disponibilidad> {
  const session = await getPortalSession()
  if (!session) return { ...SIN_HUECO }
  return calcularDisponibilidad(createAdminClient(), session.client_id, franja_id, fecha, hora)
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

  // Bandeja interna del portal (el aviso de Telegram exige bot configurado).
  await notificarCancelacionCliente({
    clientId: r.client_id as string, reservaId: r.reserva_id as string,
    modo: esCita ? 'cita' : 'reserva',
    nombreCliente: r.nombre_cliente as string,
    fecha: r.fecha as string, hora: r.hora as string | null,
  })

  return { ok: true }
}
