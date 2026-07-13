'use server'

import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'
import { enviarAvisoInterno } from '@/lib/email/enviar'

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

// Envía un mensaje de soporte que el admin recibe en su bandeja. Sin correo aún.
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
  const { error } = await db.from('soporte_mensajes').insert({
    client_id: session.client_id,
    user_id:   session.user_id,
    email:     session.email,
    asunto,
    mensaje,
    estado:    'NUEVO',
  })

  if (error) return { ok: false, error: 'No se pudo enviar el mensaje. Inténtalo de nuevo.' }

  const { data: cliente } = await db
    .from('clients').select('nombre_empresa').eq('client_id', session.client_id).maybeSingle()
  after(() => enviarAvisoInterno({
    tipo: 'aviso_soporte',
    asunto: `Nuevo mensaje de soporte: ${cliente?.nombre_empresa ?? session.client_id}`,
    cuerpo: `Nuevo mensaje de soporte.\n\nCliente: ${cliente?.nombre_empresa ?? session.client_id} (${session.client_id})\nDe: ${session.email}\nAsunto: ${asunto}\n\n${mensaje}`,
    clientId: session.client_id,
  }))

  return { ok: true }
}
