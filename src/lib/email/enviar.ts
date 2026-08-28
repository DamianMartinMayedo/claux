import { getResend } from './client'
import { createAdminClient } from '@/lib/supabase/admin'
import { leerSetting } from '@/lib/settings'
import { envolverEmail, textoAHtml } from './layout'
import { buzonesDe } from './buzones'
import type { TipoEmail } from './variables'

interface EnviarEmailInput {
  // Uno o varios. Resend admite hasta 50 destinatarios en un solo envío, y los
  // pone a todos en el «Para». Se usa para los avisos internos, que van al
  // equipo: un único envío y un único registro en `emails_log`, no N copias.
  // Para correos AL CLIENTE se sigue mandando de uno en uno — ahí un «Para» con
  // varias direcciones enseñaría los correos de unos clientes a otros.
  to:        string | string[]
  subject:   string
  html:      string
  from?:     string
  replyTo?:  string
  // Etiqueta libre para `emails_log.tipo` — los 9 tipos de PLANTILLAS_VARS para
  // correos al cliente (editables), o una etiqueta propia para avisos internos
  // al equipo (p. ej. 'aviso_lead', no editable desde el admin).
  tipo:      string
  clientId?: string | null
  // Metadatos guardados en `emails_log.meta`. Los usa el cron de recordatorios
  // (Fase 2) como guard de idempotencia: p. ej. { fecha_expiracion: '2026-08-15' }
  // para no reenviar el mismo aviso al mismo cliente por el mismo vencimiento.
  meta?:     Record<string, unknown>
  // Adjuntos (Resend): `content` en base64. Lo usa el envío de reportes al asesor
  // (PDF generado en cliente + CSV técnico generado en servidor).
  attachments?: { filename: string; content: string }[]
}

const REMITENTE_DEFAULT = 'CLAUX <notificaciones@claux.es>'

/** El aviso de «alguien pide que le llamemos». Es el único que reparte la lista
    extra de `email_avisos_leads`, así que la etiqueta no puede escribirse suelta
    en dos sitios: si se separan, la lista extra deja de recibir en silencio. */
export const TIPO_AVISO_LEAD = 'aviso_lead'

// Toggle on/off por tipo de correo, editable en la pestaña "Alertas" del admin
// (`email_on_<tipo>`, setting global). Por defecto ON si nunca se ha tocado.
export async function tipoEmailActivo(tipo: TipoEmail): Promise<boolean> {
  return (await leerSetting(`email_on_${tipo}`, 'true')) === 'true'
}

// Envío no bloqueante: si Resend falla, NO lanza — solo registra el fallo en
// `emails_log` y devuelve { ok: false }. El caller (un server action) nunca debe
// dejar de completar su operación principal por un correo caído.
export async function enviarEmail(input: EnviarEmailInput): Promise<{ ok: boolean }> {
  const db = createAdminClient()

  // `emails_log.destinatario` es texto: con varios destinos guarda la lista.
  const destinatario = Array.isArray(input.to) ? input.to.join(', ') : input.to

  try {
    const resend = getResend()
    const { data, error } = await resend.emails.send({
      from:    input.from ?? REMITENTE_DEFAULT,
      to:      input.to,
      subject: input.subject,
      html:    input.html,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    })

    if (error) {
      await db.from('emails_log').insert({
        client_id:    input.clientId ?? null,
        destinatario,
        tipo:         input.tipo,
        estado:       'fallido',
        error:        error.message,
      })
      return { ok: false }
    }

    await db.from('emails_log').insert({
      client_id:    input.clientId ?? null,
      destinatario,
      tipo:         input.tipo,
      estado:       'enviado',
      resend_id:    data?.id ?? null,
      ...(input.meta ? { meta: input.meta } : {}),
    })
    return { ok: true }
  } catch (err) {
    try {
      await db.from('emails_log').insert({
        client_id:    input.clientId ?? null,
        destinatario,
        tipo:         input.tipo,
        estado:       'fallido',
        error:        err instanceof Error ? err.message : 'Error desconocido',
      })
    } catch {
      // Ni el log debe romper el flujo principal.
    }
    return { ok: false }
  }
}

// Aviso interno al equipo de CLAUX (nuevo lead, nuevo mensaje de soporte, nuevo
// cliente). Contenido fijo en código — no es una plantilla editable.
//
// DOS listas, y la segunda es la que importa:
//
//   · `email_avisos_internos` — el buzón del equipo. Recibe TODO: leads, altas
//     de cliente, salud de la IA, socios que vencen. Por defecto contacto@claux.es.
//   · `email_avisos_leads` — buzones que reciben SOLO los avisos de lead. Es
//     para correos personales: quien quiere enterarse de que alguien pide que le
//     llamen, no de que un cron reporta la salud de la IA. Vacío por defecto.
//
// Ambas admiten varios separados por comas y van en el mismo «Para»: es correo
// interno del equipo, aquí no hay nada que ocultarse entre destinatarios.
export async function enviarAvisoInterno(params: {
  tipo:    string
  asunto:  string
  cuerpo:  string
  clientId?: string | null
}): Promise<{ ok: boolean }> {
  const [internos, leads] = await Promise.all([
    leerSetting('email_avisos_internos', 'contacto@claux.es'),
    params.tipo === TIPO_AVISO_LEAD ? leerSetting('email_avisos_leads', '') : Promise.resolve(''),
  ])
  // Set: si el mismo correo está en las dos listas, recibe UNA copia.
  const destino = [...new Set([
    ...buzonesDe(internos, 'contacto@claux.es'),
    ...buzonesDe(leads, ''),
  ])]
  return enviarEmail({
    to:      destino,
    from:    'CLAUX <contacto@claux.es>',
    subject: params.asunto,
    html:    envolverEmail(textoAHtml(params.cuerpo)),
    tipo:    params.tipo,
    clientId: params.clientId,
  })
}
