'use server'

import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'
import { crearNotificacion } from '@/lib/notificaciones/crear'
import { avisarAmpliacionSolicitada, avisarSoporteNuevo } from '@/lib/notificaciones/admin/eventos'
import { enviarEmail } from '@/lib/email/enviar'
import { envolverEmail, textoAHtml } from '@/lib/email/layout'
import { leerSetting } from '@/lib/settings'

export interface Faq {
  id:           number
  modulo_clave: string
  pregunta:     string
  respuesta:    string
}

export interface FaqGrupo {
  clave:  string
  nombre: string
  items:  Faq[]
}

// FAQ visible para el cliente: las 'general' + las de los módulos que tiene
// contratados (modulos_activos). El catálogo aporta el nombre legible del módulo.
export async function obtenerFaqPortal(): Promise<{ generales: Faq[]; porModulo: FaqGrupo[] }> {
  const session = await getPortalSession()
  if (!session) return { generales: [], porModulo: [] }

  const db = createAdminClient()
  const [{ data: cliente }, { data: catalogo }, { data: faqs }] = await Promise.all([
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).single(),
    db.from('modulos_catalogo').select('clave, nombre').eq('activo', true).order('orden'),
    db.from('soporte_faq').select('id, modulo_clave, pregunta, respuesta').eq('activo', true).order('orden'),
  ])

  const contratados: string[] = Array.isArray(cliente?.modulos_activos)
    ? (cliente.modulos_activos as string[])
    : []
  const nombrePorClave = new Map((catalogo ?? []).map(c => [c.clave, c.nombre]))
  const todas = (faqs ?? []) as Faq[]

  const generales = todas.filter(f => f.modulo_clave === 'general')
  const porModulo: FaqGrupo[] = contratados
    .map(clave => ({
      clave,
      nombre: nombrePorClave.get(clave) ?? clave,
      items:  todas.filter(f => f.modulo_clave === clave),
    }))
    .filter(g => g.items.length > 0)

  return { generales, porModulo }
}

/**
 * Interés en activar un módulo, desde el banner del dashboard.
 *
 * NO es un `mailto:`. Un mailto abre el cliente de correo del dueño —que puede no
 * estar configurado, y entonces el clic no hace nada— y sobre todo NO deja rastro:
 * el equipo no se entera de quién quiso qué. Aquí el interés queda registrado en
 * `soporte_mensajes` (se ve en /admin/soporte) y dispara un aviso al buzón
 * comercial, igual que un mensaje de soporte.
 */
export async function registrarInteresModulo(
  clave: string,
  label: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

  const nombre = label.trim().slice(0, 80)
  const modulo = clave.trim().slice(0, 40)
  if (!nombre || !modulo) return { ok: false, error: 'Falta el módulo.' }

  const asunto  = `Interés en ${nombre}`
  const mensaje = `Estoy interesado en ${nombre}. ¿Podemos agendar una cita para verlo?`

  const db = createAdminClient()
  // `modulo_clave` es lo que hace que el pedido sobreviva a la recarga: el widget
  // vuelve a pintar «Pedido el 26 jul» leyendo la clave, no adivinando el nombre
  // (que cambia con el sector: «Menú» vs «Catálogo»).
  const { error } = await db.from('soporte_mensajes').insert({
    client_id:    session.client_id,
    user_id:      session.user_id,
    email:        session.email,
    asunto,
    mensaje,
    estado:       'NUEVO',
    modulo_clave: modulo,
  })
  if (error) return { ok: false, error: 'No se pudo enviar. Inténtalo de nuevo.' }

  // Constancia en la campana del portal: el widget puede quedar detrás de un
  // filtro o de una recarga, y el dueño necesita poder comprobar que lo pidió.
  // Idempotente por entidad: pedir dos veces lo mismo no llena la bandeja.
  await crearNotificacion({
    clientId:    session.client_id,
    tipo:        'contratacion_solicitada',
    titulo:      `Pediste activar ${nombre}`,
    cuerpo:      'Recibimos tu solicitud. Te contactamos para activarlo.',
    enlace:      '/portal/soporte',
    entidadTipo: 'modulo',
    entidadId:   modulo,
  })

  const { data: cliente } = await db
    .from('clients').select('nombre_empresa').eq('client_id', session.client_id).maybeSingle()
  const empresa = cliente?.nombre_empresa ?? session.client_id

  // Bandeja del equipo: es una oportunidad de venta y tiene que quedar pendiente
  // en el panel, no solo en un correo que alguien archiva.
  await avisarAmpliacionSolicitada({
    clientId:     session.client_id,
    empresa,
    modulo,
    nombreModulo: nombre,
  })

  // Va al buzón COMERCIAL, no al de soporte: esto es una oportunidad de venta, no
  // una incidencia. `replyTo` al cliente para poder contestarle directamente.
  const destino = await leerSetting('email_contratacion', 'contacto@claux.es')
  const cuerpo =
    `${empresa} quiere activar ${nombre}.\n\n` +
    `Cliente: ${empresa} (${session.client_id})\n` +
    `De: ${session.email}\n\n` +
    `— Responde a este correo (llega al cliente) o gestiónalo en https://claux.es/admin/soporte`
  after(() => enviarEmail({
    to:       destino,
    from:     'CLAUX <contacto@claux.es>',
    replyTo:  session.email,
    subject:  `[Contratación] ${nombre} — ${empresa}`,
    html:     envolverEmail(textoAHtml(cuerpo)),
    tipo:     'aviso_soporte',
    clientId: session.client_id,
  }))

  return { ok: true }
}

// Mensaje de soporte del cliente: queda registrado en el admin (soporte_mensajes)
// y se envía directo al buzón de soporte (soporte@claux.es) con replyTo al cliente,
// para poder responder desde el correo o gestionar la incidencia desde el admin.
export async function enviarMensajeSoporte(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

  const asunto  = ((formData.get('asunto')  as string) ?? '').trim()
  const mensaje = ((formData.get('mensaje') as string) ?? '').trim()

  if (!asunto)               return { ok: false, error: 'El asunto es obligatorio.' }
  if (!mensaje)              return { ok: false, error: 'El mensaje es obligatorio.' }
  if (asunto.length > 160)   return { ok: false, error: 'El asunto es demasiado largo.' }
  if (mensaje.length > 4000) return { ok: false, error: 'El mensaje es demasiado largo (máx. 4000 caracteres).' }

  const db = createAdminClient()
  // Se pide el id: es la entidad del aviso del panel, y sin él dos mensajes del
  // mismo cliente chocarían contra el índice de idempotencia (uno se perdería).
  const { data: fila, error } = await db.from('soporte_mensajes').insert({
    client_id: session.client_id,
    user_id:   session.user_id,
    email:     session.email,
    asunto,
    mensaje,
    estado:    'NUEVO',
  }).select('id').single()

  if (error) return { ok: false, error: 'No se pudo enviar el mensaje. Inténtalo de nuevo.' }

  const { data: cliente } = await db
    .from('clients').select('nombre_empresa').eq('client_id', session.client_id).maybeSingle()
  const empresa = cliente?.nombre_empresa ?? session.client_id

  // Bandeja del equipo, además del correo a soporte@.
  await avisarSoporteNuevo({
    mensajeId: fila.id as number,
    clientId:  session.client_id,
    empresa,
    asunto,
  })

  // Notificación directa al buzón de soporte. replyTo = correo del cliente, así el
  // equipo puede responder desde el propio correo (o desde /admin/soporte).
  const destinoSoporte = await leerSetting('email_soporte', 'soporte@claux.es')
  const cuerpo =
    `Nuevo mensaje de soporte.\n\n` +
    `Cliente: ${empresa} (${session.client_id})\n` +
    `De: ${session.email}\n` +
    `Asunto: ${asunto}\n\n` +
    `${mensaje}\n\n` +
    `— Responde a este correo (llega al cliente) o gestiona la incidencia en https://claux.es/admin/soporte`
  after(() => enviarEmail({
    to:       destinoSoporte,
    from:     'CLAUX Soporte <soporte@claux.es>',
    replyTo:  session.email,
    subject:  `[Soporte] ${asunto} — ${empresa}`,
    html:     envolverEmail(textoAHtml(cuerpo)),
    tipo:     'aviso_soporte',
    clientId: session.client_id,
  }))

  return { ok: true }
}
