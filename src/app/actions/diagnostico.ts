'use server'

import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermiso } from '@/lib/admin-guard'
import { renderPlantilla } from '@/lib/email/render'
import { enviarEmail, enviarAvisoInterno, tipoEmailActivo } from '@/lib/email/enviar'

const LINK_AGENDA = 'https://calendar.app.google/nqrnpDat4JoYtd1Y8'

export type EstadoLead = 'nuevo' | 'contactado'

export interface DiagnosticoLead {
  id: number
  nombre: string
  telefono: string
  email: string | null
  sector: string
  necesidades: string[]
  modo_actual: string
  modulos_rec: string[]
  estado: EstadoLead
  created_at: string
}

// Lista de solicitudes de diagnóstico (leads) para el admin. El guardado lo hace
// el público por service_role; listarlas solo puede un admin autorizado.
export async function listarDiagnosticos(): Promise<DiagnosticoLead[]> {
  await requirePermiso('solicitudes')
  const db = createAdminClient()
  const { data } = await db
    .from('diagnosticos')
    .select('id, nombre, telefono, email, sector, necesidades, modo_actual, modulos_rec, estado, created_at')
    .order('created_at', { ascending: false })
  return (data ?? []) as DiagnosticoLead[]
}

// Marcar una solicitud como 'nuevo' o 'contactado'.
export async function actualizarEstadoDiagnostico(
  id: number,
  estado: EstadoLead,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('solicitudes')
  if (estado !== 'nuevo' && estado !== 'contactado') return { ok: false, error: 'Estado inválido.' }
  const db = createAdminClient()
  const { error } = await db.from('diagnosticos').update({ estado }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

interface GuardarDiagnosticoInput {
  nombre: string
  telefono: string
  email: string
  sector: string
  necesidades: string[]
  modoActual: string
  modulosRec: string[]
}

// Guarda el lead y NADA MÁS. Ojo con lo que se añade aquí: esto corre al pulsar
// «Ver mi informe», que es una acción de mirar, no de pedir. Los correos cuelgan
// de `solicitarContactoDiagnostico`, o sea del botón que sí los pide.
export async function guardarDiagnostico(
  input: GuardarDiagnosticoInput
): Promise<{ ok: boolean; id?: number; error?: string }> {
  const { nombre, telefono, email, sector, necesidades, modoActual, modulosRec } = input

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!nombre.trim() || !telefono.trim() || !email.trim() || !sector || !modoActual) {
    return { ok: false, error: 'Faltan datos obligatorios.' }
  }
  if (!EMAIL_RE.test(email.trim())) {
    return { ok: false, error: 'Correo no válido.' }
  }

  const db = createAdminClient()

  const { data, error } = await db.from('diagnosticos').insert({
    nombre: nombre.trim(),
    telefono: telefono.trim(),
    email: email.trim() || null,
    sector,
    necesidades,
    modo_actual: modoActual,
    modulos_rec: modulosRec,
  }).select('id').single()

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, id: data.id as number }
}

// El botón «Quiero que me contacten gratis» del informe. Manda el correo al lead
// y nos avisa a nosotros. Ambas cosas colgaban antes de `guardarDiagnostico`, así
// que le llegaba el correo de agendar cita a cualquiera que abriera el informe
// sin haber pedido nada; y este botón, por su parte, solo pintaba «¡Gracias!».
//
// SEGURIDAD — es pública y sin sesión, como todo el embudo del diagnóstico:
// · El destinatario sale de la FILA, nunca del cliente. Si viniera en el input,
//   cualquiera podría usarnos de relé para mandar correo con nuestra marca a
//   quien quisiera (que es lo que permitía la versión anterior).
// · `contacto_solicitado_at` hace el envío idempotente: un doble clic, un reintento
//   o una llamada en bucle no reenvían nada.
// · Queda que el id es un bigserial adivinable, así que alguien podría recorrerlos
//   y forzar el envío a leads que no lo pidieron — una vez por lead, y es un correo
//   nuestro a un lead nuestro, exactamente el que la versión anterior mandaba a
//   todo el mundo igualmente. Si se quiere cerrar del todo, la vía es devolver un
//   token aleatorio en `guardarDiagnostico` y pedirlo aquí, en vez del id.
export async function solicitarContactoDiagnostico(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Solicitud no válida.' }

  const db = createAdminClient()

  // Se traen TODOS los campos del lead, no solo los de contacto: el aviso interno
  // tiene que llevar lo que el cliente PIDIÓ (necesidades, cómo lo hace hoy), no
  // solo cómo llamarle. Sin eso hay que entrar al admin a mirar la ficha para
  // saber de qué va la llamada.
  const { data: lead, error } = await db
    .from('diagnosticos')
    .select('nombre, telefono, email, sector, necesidades, modo_actual, modulos_rec, contacto_solicitado_at')
    .eq('id', id)
    .single()

  if (error || !lead) return { ok: false, error: 'No encontramos tu diagnóstico.' }
  // Ya lo pidió: se responde ok (para él está hecho) pero no se reenvía nada.
  if (lead.contacto_solicitado_at) return { ok: true }

  const { error: errUpd } = await db
    .from('diagnosticos')
    .update({ contacto_solicitado_at: new Date().toISOString() })
    .eq('id', id)
    .is('contacto_solicitado_at', null)   // el candado se cierra en la propia condición

  if (errUpd) return { ok: false, error: 'No pudimos registrar tu solicitud. Inténtalo de nuevo.' }

  const nombre = lead.nombre as string
  const email = (lead.email as string | null) ?? ''

  // after(): envío garantizado tras la respuesta (un `void` suelto se pierde en
  // Vercel). Un fallo de Resend no debe romper la solicitud del lead.
  if (email) {
    after(async () => {
      if (!(await tipoEmailActivo('diagnostico_cita'))) return
      const { asunto, html } = await renderPlantilla('diagnostico_cita', {
        nombre,
        link_agenda: LINK_AGENDA,
      })
      await enviarEmail({
        to: email,
        from: 'CLAUX <contacto@claux.es>',
        replyTo: 'contacto@claux.es',
        subject: asunto,
        html,
        tipo: 'diagnostico_cita',
      })
    })
  }

  const lista = (v: unknown) => (v as string[] | null)?.join(', ') || '—'

  after(() => enviarAvisoInterno({
    tipo: 'aviso_lead',
    asunto: `Nuevo contacto: ${nombre}`,
    cuerpo: `${nombre} ha pedido que le contactéis desde su informe de diagnóstico.\n\n`
      + `── Cómo contactarle ──\n`
      + `Nombre: ${nombre}\nTeléfono: ${lead.telefono}\nEmail: ${email || '—'}\n\n`
      + `── Qué necesita ──\n`
      + `Sector: ${lead.sector}\n`
      + `Necesidades: ${lista(lead.necesidades)}\n`
      + `Cómo lo hace hoy: ${lead.modo_actual || '—'}\n`
      + `Módulos recomendados: ${lista(lead.modulos_rec)}`,
  }))

  return { ok: true }
}
