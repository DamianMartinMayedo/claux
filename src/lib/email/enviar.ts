import { getResend } from './client'
import { createAdminClient } from '@/lib/supabase/admin'
import { leerSetting } from '@/lib/settings'
import { envolverEmail, textoAHtml } from './layout'
import type { TipoEmail } from './variables'

interface EnviarEmailInput {
  to:        string
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
        destinatario: input.to,
        tipo:         input.tipo,
        estado:       'fallido',
        error:        error.message,
      })
      return { ok: false }
    }

    await db.from('emails_log').insert({
      client_id:    input.clientId ?? null,
      destinatario: input.to,
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
        destinatario: input.to,
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
// cliente). Contenido fijo en código — no es una plantilla editable. Se envía al
// buzón configurado en `email_avisos_internos` (setting), con `contacto@claux.es`
// como valor por defecto.
export async function enviarAvisoInterno(params: {
  tipo:    string
  asunto:  string
  cuerpo:  string
  clientId?: string | null
}): Promise<{ ok: boolean }> {
  const destino = await leerSetting('email_avisos_internos', 'contacto@claux.es')
  return enviarEmail({
    to:      destino,
    from:    'CLAUX <contacto@claux.es>',
    subject: params.asunto,
    html:    envolverEmail(textoAHtml(params.cuerpo)),
    tipo:    params.tipo,
    clientId: params.clientId,
  })
}
