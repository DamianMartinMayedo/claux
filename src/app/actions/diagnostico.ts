'use server'

import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermiso } from '@/lib/admin-guard'
import { renderPlantilla } from '@/lib/email/render'
import { enviarEmail, enviarAvisoInterno, tipoEmailActivo, TIPO_AVISO_LEAD } from '@/lib/email/enviar'
import { avisarLeadNuevo, avisarLeadPideContacto } from '@/lib/notificaciones/admin/eventos'
import { obtenerCatalogoPublico } from '@/lib/publico/catalogo'
import { tamanoComoTexto } from '@/lib/publico/tamano'
import { etiquetaModo } from '@/lib/publico/modos'

const LINK_AGENDA = 'https://calendar.app.google/nqrnpDat4JoYtd1Y8'

export type EstadoLead = 'nuevo' | 'contactado'

/**
 * Todo lo que el lead guarda por CLAVE, traducido a lo que el visitante leyó.
 *
 * Hace falta el catálogo vivo porque el lead no guarda texto: `tamano` son
 * índices de nivel, `nivel_rec` una clave, y sector/necesidades/módulos son las
 * etiquetas internas de sus tablas. Nada de eso se puede leer en un correo —un
 * aviso que dice «Sector: servicios · Módulos: catalogo_qr, rrhh» obliga a abrir
 * el panel para entenderlo, que es justo lo que el aviso venía a evitar—.
 *
 * Va detrás de `obtenerCatalogoPublico`, que degrada a vacío si la lectura
 * falla: entonces cada rótulo cae a su propia clave y el aviso sale en crudo.
 * Feo, pero sale — perder el aviso sería mucho peor.
 */
async function contextoLead(
  sector: string,
  tamano: Record<string, number> | null,
  nivelRec: string | null,
): Promise<{
  nivelNombre: string | null
  lineas: { pregunta: string; respuesta: string }[]
  sectorNombre: string
  rotular: (claves: unknown, cual: 'necesidades' | 'modulos') => string
}> {
  const { sectores, niveles, necesidades, modulos } = await obtenerCatalogoPublico()
  const mapas = {
    necesidades: new Map(necesidades.map((n) => [n.clave, n.etiqueta])),
    modulos:     new Map(modulos.map((m) => [m.clave, m.nombre])),
  }
  return {
    nivelNombre: niveles.find((n) => n.clave === nivelRec)?.nombre ?? nivelRec,
    lineas: tamanoComoTexto(niveles, sectores.find((s) => s.sector === sector)?.modulos ?? [], tamano),
    sectorNombre: sectores.find((s) => s.sector === sector)?.nombre ?? sector,
    rotular: (claves, cual) =>
      (claves as string[] | null)?.map((c) => mapas[cual].get(c) ?? c).join(', ') || '—',
  }
}

export interface DiagnosticoLead {
  id: number
  nombre: string
  telefono: string
  email: string | null
  sector: string
  necesidades: string[]
  modo_actual: string
  modulos_rec: string[]
  /** Nivel que le encajaba según los volúmenes que declaró. Null en los leads
      anteriores al paso de tamaño (mig. 219). */
  nivel_rec: string | null
  tamano: Record<string, number> | null
  estado: EstadoLead
  created_at: string
  /** Cuándo pulsó «Quiero que me contacten». Null si hizo el diagnóstico y se
      fue sin pedirlo: es la diferencia entre un curioso y alguien esperando una
      llamada, y hasta ahora no se veía en ninguna pantalla. */
  contacto_solicitado_at: string | null
}

// Lista de solicitudes de diagnóstico (leads) para el admin. El guardado lo hace
// el público por service_role; listarlas solo puede un admin autorizado.
export async function listarDiagnosticos(): Promise<DiagnosticoLead[]> {
  await requirePermiso('solicitudes')
  const db = createAdminClient()
  const { data } = await db
    .from('diagnosticos')
    .select('id, nombre, telefono, email, sector, necesidades, modo_actual, modulos_rec, nivel_rec, tamano, estado, created_at, contacto_solicitado_at')
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
  /** Clave del nivel recomendado ('inicial'|'empresa'|'pro'), o null si no se
      pudieron cargar los niveles: se guarda el lead igual, sin inventárselo. */
  nivelRec?: string | null
  /** Respuestas del paso de tamaño, para que quien llame sepa de dónde salió. */
  tamano?: Record<string, number>
}

// Guarda el lead y NADA MÁS. Ojo con lo que se añade aquí: esto corre al pulsar
// «Ver mi informe», que es una acción de mirar, no de pedir. Los correos cuelgan
// de `solicitarContactoDiagnostico`, o sea del botón que sí los pide.
export async function guardarDiagnostico(
  input: GuardarDiagnosticoInput
): Promise<{ ok: boolean; id?: number; error?: string }> {
  const { nombre, telefono, email, sector, necesidades, modoActual, modulosRec, nivelRec, tamano } = input

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
    nivel_rec: nivelRec ?? null,
    tamano: tamano && Object.keys(tamano).length ? tamano : null,
  }).select('id').single()

  if (error) {
    return { ok: false, error: error.message }
  }

  // Constancia en la bandeja del equipo. Va en `after()` y no antes del return
  // porque esto corre en la página pública desde Cuba: el informe no espera a que
  // se escriba un aviso interno. Severidad `info` a propósito: mirar el informe no
  // es pedir nada, y no debe saltarle un popup a nadie (ver catálogo del admin).
  const leadId = data.id as number
  after(async () => {
    // El nivel se resuelve aquí y no se acepta del formulario: viene de una
    // pantalla pública sin sesión, y el nombre de un nivel escrito por quien
    // sea acabaría pintado en la bandeja del equipo como si fuera nuestro.
    const { nivelNombre, sectorNombre } = await contextoLead(sector, tamano ?? null, nivelRec ?? null)
    await avisarLeadNuevo({
      id:     leadId,
      nombre: nombre.trim(),
      sector: sectorNombre,
      modo:   modoActual ? etiquetaModo(modoActual) : null,
      nivel:  nivelNombre,
    })
  })

  return { ok: true, id: leadId }
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
    .select('nombre, telefono, email, sector, necesidades, modo_actual, modulos_rec, nivel_rec, tamano, contacto_solicitado_at')
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

  // El TAMAÑO que declaró y el nivel al que apunta. Se guardaban desde la
  // mig. 219 y no salían por ninguna parte: ni en el correo —este select ni
  // siquiera los pedía— ni en la bandeja. O sea que quien recibía el aviso
  // tenía delante «qué necesita» pero no «de qué tamaño es», que es justo lo
  // que decide la oferta, y había que entrar al panel a mirarlo. Un lead real
  // pasó así el 2026-08-28.
  const { nivelNombre, lineas, sectorNombre, rotular } = await contextoLead(
    lead.sector as string,
    (lead.tamano as Record<string, number> | null) ?? null,
    (lead.nivel_rec as string | null) ?? null,
  )

  const bloqueTamano = lineas.length
    ? `\n\n── De qué tamaño es ──\n` + lineas.map((l) => `${l.pregunta} ${l.respuesta}`).join('\n')
    : ''
  const lineaNivel = nivelNombre ? `\nNivel que le corresponde: ${nivelNombre}` : ''

  // La bandeja del panel, además del correo: el correo es para enterarse con el
  // panel cerrado, la bandeja es donde queda pendiente hasta que alguien lo mueva.
  after(() => avisarLeadPideContacto({
    id,
    nombre,
    telefono: lead.telefono as string,
    nivel: nivelNombre,
  }))

  after(() => enviarAvisoInterno({
    tipo: TIPO_AVISO_LEAD,
    asunto: `Nuevo contacto: ${nombre}`,
    cuerpo: `${nombre} ha pedido que le contactéis desde su informe de diagnóstico.\n\n`
      + `── Cómo contactarle ──\n`
      + `Nombre: ${nombre}\nTeléfono: ${lead.telefono}\nEmail: ${email || '—'}\n\n`
      + `── Qué necesita ──\n`
      + `Sector: ${sectorNombre}\n`
      + `Necesidades: ${rotular(lead.necesidades, 'necesidades')}\n`
      + `Cómo lo hace hoy: ${lead.modo_actual ? etiquetaModo(lead.modo_actual as string) : '—'}\n`
      + `Módulos recomendados: ${rotular(lead.modulos_rec, 'modulos')}`
      + bloqueTamano
      + lineaNivel,
  }))

  return { ok: true }
}
