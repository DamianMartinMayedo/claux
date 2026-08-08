// ── Barrido diario de la agenda ───────────────────────────────────────────────
//
// Sin esto, el pasado nunca se cierra: una PENDIENTE de hace tres meses sigue
// pendiente (y engorda para siempre el aviso de «sin confirmar»), y una CONFIRMADA
// de ayer sigue confirmada aunque el cliente ya viniera —o no—. El listado deja de
// distinguir lo que hay que atender de lo que ya no existe.
//
// Dos reglas, y solo dos:
//
//  · PENDIENTE con la fecha pasada → CADUCADA. No es una suposición: se pidió, nadie
//    la contestó y el día pasó.
//  · CONFIRMADA con la fecha pasada → se respeta `DIAS_CIERRE_AUTO` días, porque solo
//    el dueño sabe si el cliente vino. Pasados esos días → ATENDIDA, marcada con
//    `cierre_auto` para que la pantalla pueda decir que la cerró el sistema y no él.
//
// Corre con service_role desde el cron: es de plataforma, no de un tenant.

import { createAdminClient } from '@/lib/supabase/admin'
import { hoyEnTz, sumarDias } from '@/lib/fecha-tz'
import { DIAS_CIERRE_AUTO } from './estados'

export interface ResumenBarrido {
  caducadas: number
  cerradas:  number
}

/** Días que se guarda el dedupe de Telegram. Más memoria que esta no hace falta. */
const DIAS_UPDATES = 7
/** Días que se guarda el log de entrega: es diagnóstico, no un histórico. */
const DIAS_ENVIOS  = 90

export async function barrerReservas(): Promise<ResumenBarrido> {
  const db  = createAdminClient()
  // La fecha de una reserva es la del NEGOCIO (America/Havana), no la del servidor:
  // el cron corre en UTC y de madrugada eso es el día siguiente.
  const hoy   = hoyEnTz()
  const corte = sumarDias(hoy, -DIAS_CIERRE_AUTO)
  const ahora = new Date().toISOString()

  const { data: caducadas } = await db.from('reservas')
    .update({ estado: 'CADUCADA', updated_at: ahora })
    .eq('estado', 'PENDIENTE')
    .lt('fecha', hoy)
    .select('reserva_id')

  const { data: cerradas } = await db.from('reservas')
    .update({ estado: 'ATENDIDA', cierre_auto: true, updated_at: ahora })
    .eq('estado', 'CONFIRMADA')
    .lt('fecha', corte)
    .select('reserva_id')

  // TG-15: `telegram_updates` no se purgaba NUNCA (las sesiones sí, con un 10 % de
  // probabilidad al azar). Es una tabla de dedupe: a los 7 días no sirve de nada.
  const corteUpdates = new Date(Date.now() - DIAS_UPDATES * 86_400_000).toISOString()
  await db.from('telegram_updates').delete().lt('recibido_at', corteUpdates)

  const corteEnvios = new Date(Date.now() - DIAS_ENVIOS * 86_400_000).toISOString()
  await db.from('telegram_envios').delete().lt('created_at', corteEnvios)

  return {
    caducadas: (caducadas ?? []).length,
    cerradas:  (cerradas  ?? []).length,
  }
}
