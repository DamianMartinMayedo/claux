// Notificaciones internas POR EVENTO: se disparan dentro de la acción que las
// provoca, no en el cron. Un envoltorio por evento para que el call site sea una
// línea y el texto del aviso viva en un solo sitio.
//
// Nunca lanzan (crearNotificacion ya traga sus errores): un aviso que falla no
// puede tumbar la reserva que lo originó.

import { fmtFechaEs } from '@/lib/date-utils'
import { crearNotificacion } from './crear'

/**
 * Nueva reserva o cita entrante (web o bot). El dueño ya recibe el aviso de
 * Telegram si tiene bot; esto lo deja además en su bandeja del portal, que es
 * donde puede actuar.
 */
export async function notificarReservaEntrante(params: {
  clientId:      string
  reservaId:     string
  /** `agenda` (citas por profesional) o `reservas_citas` (aforo). */
  modo:          'reserva' | 'cita'
  nombreCliente: string
  fecha:         string
  hora:          string | null
  /** Aforo: nº de personas. Agenda: nombre del servicio. */
  detalle?:      string | null
  pendiente:     boolean
}): Promise<void> {
  const esCita = params.modo === 'cita'
  const cuando = `${fmtFechaEs(params.fecha)}${params.hora ? ` a las ${params.hora.slice(0, 5)}` : ''}`

  await crearNotificacion({
    clientId: params.clientId,
    tipo:     esCita ? 'cita_nueva' : 'reserva_nueva',
    titulo:   esCita
      ? `Nueva cita — ${params.nombreCliente}`
      : `Nueva reserva — ${params.nombreCliente}`,
    cuerpo: [
      cuando,
      params.detalle || null,
      params.pendiente ? 'Pendiente de confirmar.' : null,
    ].filter(Boolean).join(' · '),
    enlace:      esCita ? '/portal/citas' : '/portal/reservas',
    entidadTipo: 'reserva',
    entidadId:   params.reservaId,
  })
}
