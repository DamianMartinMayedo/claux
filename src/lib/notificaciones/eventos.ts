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

/** El cliente canceló por su enlace público: el hueco vuelve a estar libre. */
export async function notificarCancelacionCliente(params: {
  clientId:      string
  reservaId:     string
  modo:          'reserva' | 'cita'
  nombreCliente: string
  fecha:         string
  hora:          string | null
}): Promise<void> {
  const esCita = params.modo === 'cita'
  const cuando = `${fmtFechaEs(params.fecha)}${params.hora ? ` a las ${params.hora.slice(0, 5)}` : ''}`

  await crearNotificacion({
    clientId: params.clientId,
    tipo:     'reserva_cancelada_cliente',
    titulo:   `${esCita ? 'Cita' : 'Reserva'} cancelada — ${params.nombreCliente}`,
    cuerpo:   `${cuando}. La canceló el cliente desde su enlace, el hueco queda libre.`,
    enlace:   esCita ? '/portal/citas' : '/portal/reservas',
    // Entidad propia: la reserva ya tiene un aviso de "nueva" con este id, y
    // compartirlo haría que la cancelación chocara contra el índice de dedupe.
    entidadTipo: 'reserva_cancelada',
    entidadId:   params.reservaId,
  })
}

/** CLAUX confirmó un pago de la suscripción del negocio. */
export async function notificarPagoConfirmado(params: {
  clientId:        string
  montoUsd:        number
  fechaExpiracion: string
}): Promise<void> {
  await crearNotificacion({
    clientId: params.clientId,
    tipo:     'pago_confirmado',
    titulo:   'Pago confirmado',
    cuerpo:   `Recibimos tu pago de ${params.montoUsd.toFixed(2)} USD. Tu suscripción queda cubierta hasta el ${fmtFechaEs(params.fechaExpiracion)}.`,
    enlace:   '/portal/facturacion',
    // El periodo pagado identifica el hecho: dos pagos distintos, dos avisos.
    entidadTipo: 'pago',
    entidadId:   params.fechaExpiracion,
  })
}
