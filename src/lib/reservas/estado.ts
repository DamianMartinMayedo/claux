// ── Estado de reservas: máquina de transiciones + notificaciones ──
// Módulo compartido por las server actions del portal (cambio de estado con
// sesión) y por el webhook de Telegram (acciones del dueño desde el chat).
// No comprueba permisos: el llamador es responsable de autorizar.

import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarMensaje, type ReplyMarkup } from '@/lib/telegram/enviar'
import { hoyEnTz } from '@/lib/fecha-tz'
import { CAMBIOS_VALIDOS, ESTADOS_OCUPAN, ESTADO_LABEL, type EstadoReserva } from './estados'

// El catálogo de estados vive en `estados.ts` (módulo puro, sin Telegram detrás) para
// que la vista pública de gestión por token pueda usarlo. Se reexporta aquí porque es
// de donde lo importaba medio repo.
export { CAMBIOS_VALIDOS, ESTADO_LABEL }
export type { EstadoReserva }

export interface ReservaNotif {
  reserva_id:       string
  fecha:            string
  hora:             string | null
  personas:         number
  nombre_cliente:   string
  telefono:         string | null
  notas:            string | null
  estado:           EstadoReserva
  telegram_chat_id: string | null
}

interface BotCfgMin {
  token:  string | null
  activo: boolean
  /** Para registrar la entrega (TG-2). Sin esto el envío no queda en el log. */
  clientId?: string
  columna?:  'bot_config' | 'bot_config_citas'
}

// El log necesita saber de quién es el mensaje. Si el llamador no lo pasa, no se
// registra — pero no se rompe nada: el aviso se manda igual.
function origenDe(cfg: BotCfgMin, tipo: 'reserva_nueva' | 'estado') {
  return cfg.clientId && cfg.columna
    ? { clientId: cfg.clientId, columna: cfg.columna, tipo }
    : undefined
}

function fmtFecha(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}
function fmtHora(h: string | null): string { return h ? h.substring(0, 5) : '—' }

// ── Textos ──────────────────────────────────────────────────────────────────

export function textoReservaNueva(r: ReservaNotif, negocio: string): string {
  return [
    `🆕 Nueva reserva — ${negocio}`,
    `📅 ${fmtFecha(r.fecha)}  🕐 ${fmtHora(r.hora)}`,
    `👥 ${r.personas}  ·  ${r.nombre_cliente}`,
    r.telefono ? `📞 ${r.telefono}` : null,
    r.notas ? `📝 ${r.notas}` : null,
    r.estado === 'PENDIENTE' ? '\nPendiente de confirmar.' : `\nEstado: ${r.estado}`,
  ].filter(Boolean).join('\n')
}

export function botonesGestionReserva(reserva_id: string): ReplyMarkup {
  return {
    inline_keyboard: [[
      { text: '✅ Confirmar', callback_data: `res:CONFIRMADA:${reserva_id}` },
      { text: '✕ Rechazar',  callback_data: `res:RECHAZADA:${reserva_id}` },
    ]],
  }
}

function textoCambioEstadoCliente(r: ReservaNotif, estado: EstadoReserva, negocio: string): string | null {
  const cab = `${negocio}\n📅 ${fmtFecha(r.fecha)} 🕐 ${fmtHora(r.hora)} · ${r.personas} pers.`
  switch (estado) {
    case 'CONFIRMADA': return `✅ ¡Reserva confirmada!\n${cab}\n¡Te esperamos!`
    case 'RECHAZADA':  return `❌ Reserva no disponible\n${cab}\nLo sentimos, no podemos atender esa reserva.`
    case 'CANCELADA':  return `🚫 Reserva cancelada\n${cab}`
    case 'PENDIENTE':  return `↩️ Reserva recuperada\n${cab}\nVuelve a estar pendiente de confirmar.`
    // NO_SHOW, ATENDIDA y CADUCADA son notas internas del negocio: al cliente no se
    // le escribe «no viniste» ni «tu reserva caducó».
    default:           return null
  }
}

// ── Notificaciones (no-op si no hay bot activo / destinatario) ────────────────

export async function notificarReservaNueva(
  botCfg: BotCfgMin & { notificar_owner_chat_id: string | null },
  r: ReservaNotif,
  negocio: string,
): Promise<void> {
  if (!botCfg.token || !botCfg.activo || !botCfg.notificar_owner_chat_id) return
  const markup = r.estado === 'PENDIENTE' ? botonesGestionReserva(r.reserva_id) : undefined
  await enviarMensaje(botCfg.token, botCfg.notificar_owner_chat_id, textoReservaNueva(r, negocio), markup,
    origenDe(botCfg, 'reserva_nueva'))
}

export async function notificarClienteEstado(
  botCfg: BotCfgMin,
  r: ReservaNotif,
  estado: EstadoReserva,
  negocio: string,
): Promise<void> {
  if (!botCfg.token || !botCfg.activo || !r.telegram_chat_id) return
  const texto = textoCambioEstadoCliente(r, estado, negocio)
  if (texto) await enviarMensaje(botCfg.token, r.telegram_chat_id, texto, undefined, origenDe(botCfg, 'estado'))
}

// ── Transición de estado (validada) + aviso al cliente ────────────────────────

/**
 * Deshacer (CANCELADA/RECHAZADA → PENDIENTE) vuelve a OCUPAR la plaza, y esa plaza
 * pudo llenarse mientras tanto. La reapertura no pasa por `res_crear_*`, así que la
 * revalidación se hace aquí: es el único sitio por el que pasan las dos vías (portal
 * y bot) y así no se puede olvidar en una de ellas.
 */
async function huecoLibreParaReabrir(
  db: SupabaseClient,
  client_id: string,
  r: { reserva_id: string; fecha: string; hora: string | null; hora_fin: string | null;
       personas: number; franja_id: string | null; recurso_id: string | null },
): Promise<{ ok: boolean; error?: string }> {
  if (r.fecha < hoyEnTz()) {
    return { ok: false, error: 'Esa fecha ya pasó: no se puede recuperar.' }
  }
  if (!r.hora || !r.hora_fin) return { ok: true }   // sin horas no hay solape que medir

  const solapadas = db.from('reservas')
    .select('personas')
    .eq('client_id', client_id)
    .eq('fecha', r.fecha)
    .neq('reserva_id', r.reserva_id)
    .in('estado', ESTADOS_OCUPAN)
    .lt('hora', r.hora_fin)
    .gt('hora_fin', r.hora)

  // Cita: el profesional no se desdobla, basta con que exista una que se solape.
  if (r.recurso_id) {
    const { data } = await solapadas.eq('recurso_id', r.recurso_id).limit(1)
    if ((data ?? []).length > 0) return { ok: false, error: 'Esa hora ya está ocupada.' }
    return { ok: true }
  }

  // Reserva de aforo: suma de personas contra la capacidad del turno.
  if (r.franja_id) {
    const [{ data: ocupa }, { data: franja }] = await Promise.all([
      solapadas.eq('franja_id', r.franja_id),
      db.from('reserva_franjas').select('capacidad')
        .eq('franja_id', r.franja_id).eq('client_id', client_id).maybeSingle(),
    ])
    const capacidad = Number(franja?.capacidad ?? 0)
    const ocupado = (ocupa ?? []).reduce((s, x) => s + Number(x.personas ?? 0), 0)
    if (capacidad > 0 && ocupado + Number(r.personas) > capacidad) {
      return { ok: false, error: `Ya no cabe: el turno tiene ${ocupado} de ${capacidad}.` }
    }
  }
  return { ok: true }
}

export async function transicionarEstado(
  db: SupabaseClient,
  client_id: string,
  reserva_id: string,
  nuevoEstado: EstadoReserva,
  negocio: string,
  botCfg: BotCfgMin,
): Promise<{ ok: boolean; error?: string }> {
  const { data: reserva } = await db.from('reservas')
    .select('reserva_id, fecha, hora, hora_fin, personas, nombre_cliente, telefono, notas, estado, telegram_chat_id, franja_id, recurso_id')
    .eq('reserva_id', reserva_id)
    .eq('client_id', client_id)
    .single()
  if (!reserva) return { ok: false, error: 'Reserva no encontrada.' }

  const actual = reserva.estado as EstadoReserva
  if (!CAMBIOS_VALIDOS[actual]?.includes(nuevoEstado)) {
    const de = ESTADO_LABEL[actual] ?? actual
    const a  = ESTADO_LABEL[nuevoEstado] ?? nuevoEstado
    return { ok: false, error: `No se puede pasar de «${de}» a «${a}».` }
  }

  if (nuevoEstado === 'PENDIENTE') {
    const hueco = await huecoLibreParaReabrir(db, client_id, reserva as Parameters<typeof huecoLibreParaReabrir>[2])
    if (!hueco.ok) return hueco
  }

  const { error } = await db.from('reservas')
    .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
    .eq('reserva_id', reserva_id)
    .eq('client_id', client_id)
  if (error) return { ok: false, error: error.message }

  await notificarClienteEstado(botCfg, reserva as ReservaNotif, nuevoEstado, negocio)
  return { ok: true }
}
