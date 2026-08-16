'use server'

// Solicitud de acceso de un miembro del equipo al administrador. Nace donde muerde:
// en un módulo que el usuario solo puede CONSULTAR (los botones de escritura están
// ocultos), una línea le deja pedir poder editarlo. Llega por dos vías a la vez —la
// campana interna (bandeja del negocio) y correo a todos los administradores— porque
// puede que el admin no mire la campana en el momento. No es correo al cliente final:
// son los compañeros que pueden conceder el permiso en Usuarios.
//
// Self-service por diseño: quien la lanza es precisamente quien NO tiene el permiso,
// así que no lleva candado de módulo. El anti-spam es la idempotencia por
// usuario+módulo de `crearNotificacion` (una pendiente por par), no un módulo contratado.

import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'
import { crearNotificacion } from '@/lib/notificaciones/crear'
import { enviarEmail } from '@/lib/email/enviar'
import { envolverEmail, textoAHtml } from '@/lib/email/layout'

export async function solicitarAccesoModulo(
  modulo: string,
  nota?: string,
): Promise<{ ok: boolean; yaEnviada?: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión no válida.' }

  const clave = (modulo ?? '').trim()
  if (!clave) return { ok: false, error: 'Módulo no indicado.' }
  const notaLimpia = (nota ?? '').trim().slice(0, 500)

  const db = createAdminClient()
  const [{ data: mod }, { data: quien }] = await Promise.all([
    db.from('modulos_catalogo').select('nombre').eq('clave', clave).maybeSingle(),
    db.from('client_users').select('nombre').eq('user_id', session.user_id).maybeSingle(),
  ])
  const nombreModulo = mod?.nombre ?? clave
  const solicitante  = quien?.nombre || session.email

  // Notificación interna para los administradores (bandeja compartida del negocio).
  // Idempotente por usuario+módulo (entidad): si ya hay una pendiente, devuelve false
  // y no duplicamos ni reenviamos correo.
  const creada = await crearNotificacion({
    clientId:    session.client_id,
    tipo:        'solicitud_acceso',
    titulo:      `${solicitante} pide acceso para editar ${nombreModulo}`,
    cuerpo:      notaLimpia
      ? `Solo puede consultar ${nombreModulo}. Nota: ${notaLimpia}`
      : `Solo puede consultar ${nombreModulo} y pide poder editarlo.`,
    enlace:      '/portal/usuarios',
    entidadTipo: 'solicitud_acceso',
    entidadId:   `${session.user_id}:${clave}`,
    meta:        { usuario_id: session.user_id, usuario_email: session.email, modulo: clave, nota: notaLimpia || null },
  })

  // Ya había una solicitud pendiente por este par: nada que reenviar.
  if (!creada) return { ok: true, yaEnviada: true }

  // Correo a TODOS los administradores activos del negocio, además de la campana.
  after(async () => {
    const { data: admins } = await db
      .from('client_users')
      .select('email')
      .eq('client_id', session.client_id)
      .eq('rol', 'admin_empresa')
      .eq('estado', 'ACTIVO')
    const correos = [...new Set((admins ?? []).map(a => a.email).filter(Boolean) as string[])]
    if (correos.length === 0) return

    const cuerpo =
      `${solicitante} (${session.email}) solo puede consultar «${nombreModulo}» y pide poder editarlo.\n\n` +
      (notaLimpia ? `Nota: ${notaLimpia}\n\n` : '') +
      `Si es correcto, concédele el acceso en Usuarios del portal:\n` +
      `https://claux.es/portal/usuarios`
    const html = envolverEmail(textoAHtml(cuerpo))

    for (const to of correos) {
      await enviarEmail({
        to,
        replyTo:  session.email,
        subject:  `Solicitud de acceso: ${nombreModulo}`,
        html,
        tipo:     'solicitud_acceso',
        clientId: session.client_id,
      })
    }
  })

  return { ok: true }
}
