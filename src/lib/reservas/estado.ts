// ── Estado de reservas: máquina de transiciones + notificaciones ──
// Módulo compartido por las server actions del portal (cambio de estado con
// sesión) y por el webhook de Telegram (acciones del dueño desde el chat).
// No comprueba permisos: el llamador es responsable de autorizar.

import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarMensaje, type ReplyMarkup } from '@/lib/telegram/enviar'

export type EstadoReserva = 'PENDIENTE' | 'CONFIRMADA' | 'RECHAZADA' | 'NO_SHOW' | 'CANCELADA'

export const CAMBIOS_VALIDOS: Record<EstadoReserva, EstadoReserva[]> = {
  PENDIENTE:  ['CONFIRMADA', 'RECHAZADA', 'CANCELADA'],
  CONFIRMADA: ['NO_SHOW', 'CANCELADA'],
  RECHAZADA:  [],
  NO_SHOW:    [],
  CANCELADA:  [],
}

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
    default:           return null // NO_SHOW no se notifica al cliente
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
  await enviarMensaje(botCfg.token, botCfg.notificar_owner_chat_id, textoReservaNueva(r, negocio), markup)
}

export async function notificarClienteEstado(
  botCfg: BotCfgMin,
  r: ReservaNotif,
  estado: EstadoReserva,
  negocio: string,
): Promise<void> {
  if (!botCfg.token || !botCfg.activo || !r.telegram_chat_id) return
  const texto = textoCambioEstadoCliente(r, estado, negocio)
  if (texto) await enviarMensaje(botCfg.token, r.telegram_chat_id, texto)
}

// ── Transición de estado (validada) + aviso al cliente ────────────────────────

export async function transicionarEstado(
  db: SupabaseClient,
  client_id: string,
  reserva_id: string,
  nuevoEstado: EstadoReserva,
  negocio: string,
  botCfg: BotCfgMin,
): Promise<{ ok: boolean; error?: string }> {
  const { data: reserva } = await db.from('reservas')
    .select('reserva_id, fecha, hora, personas, nombre_cliente, telefono, notas, estado, telegram_chat_id')
    .eq('reserva_id', reserva_id)
    .eq('client_id', client_id)
    .single()
  if (!reserva) return { ok: false, error: 'Reserva no encontrada.' }

  const actual = reserva.estado as EstadoReserva
  if (!CAMBIOS_VALIDOS[actual]?.includes(nuevoEstado)) {
    return { ok: false, error: `No se puede pasar de «${actual}» a «${nuevoEstado}».` }
  }

  const { error } = await db.from('reservas')
    .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
    .eq('reserva_id', reserva_id)
    .eq('client_id', client_id)
  if (error) return { ok: false, error: error.message }

  await notificarClienteEstado(botCfg, reserva as ReservaNotif, nuevoEstado, negocio)
  return { ok: true }
}
