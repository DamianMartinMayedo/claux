'use server'

import { requirePermiso } from '@/lib/admin-guard'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TOPE_VER_MAS } from '@/lib/listados'
import { logActividad } from '@/lib/audit'
import { isAuthBypassed } from '@/lib/dev-auth'
import { revalidatePath } from 'next/cache'
import { renderPlantilla } from '@/lib/email/render'
import { enviarEmail, tipoEmailActivo } from '@/lib/email/enviar'
import { leerCorreo } from '@/lib/settings'
import { borradorSoporte } from '@/lib/ia/equipo'
import { IaBolsaAgotada } from '@/lib/ia/interna'

// Guard: el admin debe estar autenticado (o bypass en dev). Los datos se leen/escriben
// con service_role, igual que el resto de la plataforma.
async function adminAutenticado(): Promise<boolean> {
  if (isAuthBypassed()) return true
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  return !!user
}

// ── Mensajes ────────────────────────────────────────────────────────────────

export interface MensajeSoporte {
  id:             number
  client_id:      string
  user_id:        string | null
  nombre_empresa: string
  email:          string | null
  asunto:         string
  mensaje:        string
  estado:         'NUEVO' | 'LEIDO' | 'RESUELTO'
  respuesta:      string | null
  respuesta_at:   string | null
  created_at:     string
  /**
   * Solo lo traen los mensajes nacidos del banner de captación del dashboard:
   * es una OPORTUNIDAD DE VENTA, no una incidencia, y se atiende distinto.
   */
  modulo_clave:   string | null
}

export async function listarMensajesSoporte(): Promise<MensajeSoporte[]> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return []
  const db = createAdminClient()

  const { data: msgs } = await db
    .from('soporte_mensajes')
    .select('id, client_id, user_id, email, asunto, mensaje, estado, respuesta, respuesta_at, created_at, modulo_clave')
    .order('created_at', { ascending: false })
    // TECHO EXPLÍCITO: la bandeja no se pagina, así que crece con cada mensaje que
    // escribe cualquier cliente. Escrito aquí, el día que la cifra se acerque se ve
    // en el código y no en una bandeja a la que le faltan los mensajes viejos.
    .limit(TOPE_VER_MAS)

  const ids = [...new Set((msgs ?? []).map(m => m.client_id))]
  const { data: clientes } = await db
    .from('clients')
    .select('client_id, nombre_empresa')
    .in('client_id', ids.length ? ids : ['__none__'])
  const nombre = new Map((clientes ?? []).map(c => [c.client_id, c.nombre_empresa]))

  return (msgs ?? []).map(m => ({
    ...m,
    nombre_empresa: nombre.get(m.client_id) ?? m.client_id,
  })) as MensajeSoporte[]
}

// ── Ampliaciones: lo mismo, visto desde VENTAS ──────────────────────────────
//
// Un cliente que pide activar un módulo NO es un lead del diagnóstico: no tiene
// teléfono ni «modo actual» (el formulario público sí los exige) y ya es cliente.
// Por eso no se copia a `diagnosticos`; se lee la MISMA fila de `soporte_mensajes`
// desde la sección de Ventas, filtrando por `modulo_clave`. Una fila, dos vistas:
// soporte la ve como mensaje y ventas como oportunidad, sin duplicar el dato.
//
// El candado es `solicitudes` —el permiso que ya tiene el rol de ventas—, no
// `soporte`: ver las ampliaciones no debe abrirle toda la bandeja de incidencias.

export interface Ampliacion {
  id:             number
  client_id:      string
  nombre_empresa: string
  /** Persona de contacto del cliente, para saber a quién se llama. */
  contacto:       string | null
  /** Quién lo pidió desde el portal. */
  email:          string | null
  modulo_clave:   string
  /** Nombre comercial del módulo (catálogo). Si no está, se cae a la clave. */
  modulo:         string
  estado:         'NUEVO' | 'LEIDO' | 'RESUELTO'
  created_at:     string
  /** El cliente está marcado como de prueba. Es la bandera que decide qué se
   *  puede borrar, y la misma que deja a estos clientes fuera del panel. */
  es_prueba:      boolean
  /** Ya tiene una respuesta escrita: hay conversación dentro. */
  respondida:     boolean
  /** No es una venta: es «quiero recuperar el acceso» (ver NO_SON_MODULOS). */
  es_reactivacion: boolean
}

// `modulo_clave` no siempre es un módulo. `pedirReactivacion()` escribe
// 'reactivacion' en ese mismo campo para que la petición sobreviva a la recarga,
// y como esta lista se arma con «tiene modulo_clave», la de reactivación acaba
// aquí. No está en `modulos_catalogo`, así que sin este mapa la pantalla enseña
// la clave en crudo y parece un módulo que nadie reconoce.
const NO_SON_MODULOS: Record<string, string> = {
  reactivacion: 'Reactivación de la cuenta',
}

export async function listarAmpliaciones(): Promise<Ampliacion[]> {
  await requirePermiso('solicitudes')
  if (!(await adminAutenticado())) return []
  const db = createAdminClient()

  const { data: msgs } = await db
    .from('soporte_mensajes')
    .select('id, client_id, email, modulo_clave, estado, created_at, respuesta')
    .not('modulo_clave', 'is', null)
    // TECHO EXPLÍCITO: sin `.limit()` lo pone PostgREST por su cuenta y recorta sin
    // decir nada. Escrito aquí, el día que la cifra se acerque se ve en el código y no
    // en una lista a la que le faltan filas.
    .order('created_at', { ascending: false })
    .limit(TOPE_VER_MAS)

  const ids = [...new Set((msgs ?? []).map(m => m.client_id))]
  const [{ data: clientes }, { data: catalogo }] = await Promise.all([
    db.from('clients').select('client_id, nombre_empresa, nombre_contacto, es_prueba')
      .in('client_id', ids.length ? ids : ['__none__']),
    db.from('modulos_catalogo').select('clave, nombre'),
  ])
  const cliente = new Map((clientes ?? []).map(c => [c.client_id, c]))
  const nombreModulo = new Map((catalogo ?? []).map(c => [c.clave, c.nombre]))

  return (msgs ?? []).map(m => ({
    id:             m.id as number,
    client_id:      m.client_id as string,
    nombre_empresa: cliente.get(m.client_id)?.nombre_empresa ?? m.client_id,
    contacto:       cliente.get(m.client_id)?.nombre_contacto ?? null,
    email:          m.email as string | null,
    modulo_clave:   m.modulo_clave as string,
    modulo:         nombreModulo.get(m.modulo_clave as string)
                      ?? NO_SON_MODULOS[m.modulo_clave as string]
                      ?? (m.modulo_clave as string),
    estado:         m.estado as Ampliacion['estado'],
    created_at:     m.created_at as string,
    es_prueba:      cliente.get(m.client_id)?.es_prueba === true,
    respondida:     m.respuesta != null,
    es_reactivacion: (m.modulo_clave as string) in NO_SON_MODULOS,
  }))
}

/** Mismo cambio de estado que en soporte, con el candado de ventas. */
export async function actualizarEstadoAmpliacion(
  id: number,
  estado: 'NUEVO' | 'LEIDO' | 'RESUELTO',
): Promise<{ ok: boolean }> {
  await requirePermiso('solicitudes')
  if (!(await adminAutenticado())) return { ok: false }
  if (!['NUEVO', 'LEIDO', 'RESUELTO'].includes(estado)) return { ok: false }
  const { error } = await createAdminClient()
    .from('soporte_mensajes')
    .update({ estado })
    .eq('id', id)
    .not('modulo_clave', 'is', null)   // desde ventas solo se tocan ampliaciones
  if (error) return { ok: false }
  revalidatePath('/admin/ventas/ampliaciones')
  revalidatePath('/admin/soporte')
  return { ok: true }
}

// ── Borrar ampliaciones de prueba ───────────────────────────────────────────
//
// Mismo problema que el de los leads y misma forma de resolverlo: la pantalla
// solo sabía cambiar estados, así que las filas de `Restaurante test` llevaban
// desde julio contando como «sin contactar». La diferencia es que aquí no hace
// falta adivinar cuáles son de prueba: `clients.es_prueba` ya lo dice.
//
// Quien manda es `eliminar_ampliacion` (mig. 228): comprobar y borrar en la
// misma operación, con la fila bloqueada. Esto solo traduce su código.

export interface ResultadoLoteAmpliaciones {
  hechas:   number
  omitidas: { etiqueta: string; motivo: string }[]
  error?:   string
}

/** El código de `eliminar_ampliacion`, en palabras de quien lo va a leer. */
function motivoAmpliacion(codigo: string): string {
  switch (codigo) {
    case 'cliente_real':
      return 'Es de un cliente real: su petición no se borra, aunque sea vieja.'
    case 'respondida':
      return 'Ya tiene una respuesta escrita, y borrarla la perdería.'
    case 'no_es_ampliacion':
      return 'No es una ampliación, es un mensaje de soporte: se atiende en Soporte.'
    case 'sin_cliente':
      return 'Su cliente ya no existe. Revísala antes de borrarla.'
    default:
      return 'No se pudo eliminar.'
  }
}

export async function eliminarAmpliacion(
  id: number,
): Promise<{ ok: boolean; error?: string; yaEliminada?: boolean }> {
  const ctx = await requirePermiso('solicitudes')
  if (!(await adminAutenticado())) return { ok: false, error: 'Sesión no válida.' }
  const db = createAdminClient()

  const { data: fila } = await db
    .from('soporte_mensajes')
    .select('id, client_id, modulo_clave')
    .eq('id', id)
    .maybeSingle()
  // La lista pudo quedarse abierta en otra pestaña: si ya no está, se trata como
  // hecho para que al refrescar desaparezca la fila en vez de dar un error.
  if (!fila) return { ok: true, yaEliminada: true }

  const { data: codigo, error } = await db.rpc('eliminar_ampliacion', { p_id: id })
  if (error) return { ok: false, error: error.message }
  if (codigo === 'no_existe') return { ok: true, yaEliminada: true }
  if (codigo !== 'ok') return { ok: false, error: motivoAmpliacion(String(codigo)) }

  // Los avisos de la bandeja apuntan a esto de dos maneras y ninguna es una FK:
  // la ampliación va por `cliente:modulo` y la reactivación entró por el buzón
  // genérico de soporte, con el id del mensaje. Se archivan las dos formas; un
  // fallo aquí no tumba el borrado, que ya está hecho.
  const claves: { tipo: string; valor: string }[] = [
    { tipo: 'ampliacion', valor: `${fila.client_id}:${fila.modulo_clave}` },
    { tipo: 'soporte',    valor: String(id) },
  ]
  for (const k of claves) {
    const { error: errAviso } = await db
      .from('admin_notificaciones')
      .update({ resuelta: true, estado: 'archivada' })
      .eq('entidad_tipo', k.tipo)
      .eq('entidad_id', k.valor)
      .eq('resuelta', false)
    if (errAviso) console.error('[ampliaciones] no se pudo archivar el aviso', k.valor, errAviso.message)
  }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'ampliacion',
    entity_id:   String(id),
    action:      'eliminar',
    description: `Ampliación eliminada: ${fila.client_id} pedía ${fila.modulo_clave}`,
  })

  revalidatePath('/admin/ventas/ampliaciones')
  revalidatePath('/admin/soporte')
  return { ok: true }
}

/**
 * En lote: envuelve la individual, así que hereda su candado y su auditoría.
 * Cada fila se resuelve por separado —una de cliente real no aborta el resto— y
 * vuelve el reparto para que el resumen diga qué se hizo y qué no.
 */
export async function eliminarAmpliacionesEnLote(ids: number[]): Promise<ResultadoLoteAmpliaciones> {
  await requirePermiso('solicitudes')
  const res: ResultadoLoteAmpliaciones = { hechas: 0, omitidas: [] }
  if (ids.length === 0) return res

  const db = createAdminClient()
  // Los nombres de una vez: el resumen dice «Restaurante test», no «#5».
  const { data: filas } = await db
    .from('soporte_mensajes')
    .select('id, client_id')
    .in('id', ids)
  const { data: clientes } = await db
    .from('clients')
    .select('client_id, nombre_empresa')
    .in('client_id', [...new Set((filas ?? []).map(f => f.client_id as string))].length
      ? [...new Set((filas ?? []).map(f => f.client_id as string))]
      : ['__none__'])
  const empresa = new Map((clientes ?? []).map(c => [c.client_id, c.nombre_empresa]))
  const deFila = new Map((filas ?? []).map(f => [f.id as number, empresa.get(f.client_id as string) ?? (f.client_id as string)]))

  for (const id of ids) {
    const etiqueta = deFila.get(id) ?? `#${id}`
    const r = await eliminarAmpliacion(id)
    if (r.ok) res.hechas++
    else res.omitidas.push({ etiqueta, motivo: r.error ?? 'No se pudo eliminar' })
  }

  revalidatePath('/admin/ventas/ampliaciones')
  return res
}

export async function actualizarEstadoMensaje(
  id: number,
  estado: 'NUEVO' | 'LEIDO' | 'RESUELTO',
): Promise<{ ok: boolean }> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return { ok: false }
  if (!['NUEVO', 'LEIDO', 'RESUELTO'].includes(estado)) return { ok: false }
  const { error } = await createAdminClient()
    .from('soporte_mensajes')
    .update({ estado })
    .eq('id', id)
  if (error) return { ok: false }
  revalidatePath('/admin/soporte')
  return { ok: true }
}

// ── FAQ (CRUD) ──────────────────────────────────────────────────────────────

export interface FaqAdmin {
  id:           number
  modulo_clave: string
  pregunta:     string
  respuesta:    string
  orden:        number
  activo:       boolean
}

export async function listarFaqAdmin(): Promise<FaqAdmin[]> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return []
  const { data } = await createAdminClient()
    .from('soporte_faq')
    .select('id, modulo_clave, pregunta, respuesta, orden, activo')
    .order('modulo_clave')
    .order('orden')
  return (data ?? []) as FaqAdmin[]
}

export async function guardarFaq(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return { ok: false, error: 'No autorizado.' }

  const id           = ((formData.get('id')           as string) ?? '').trim()
  const modulo_clave = ((formData.get('modulo_clave') as string) ?? 'general').trim() || 'general'
  const pregunta     = ((formData.get('pregunta')     as string) ?? '').trim()
  const respuesta    = ((formData.get('respuesta')    as string) ?? '').trim()
  const orden        = parseInt((formData.get('orden') as string) ?? '0', 10) || 0
  const activo       = formData.get('activo') !== 'false'

  if (!pregunta)  return { ok: false, error: 'La pregunta es obligatoria.' }
  if (!respuesta) return { ok: false, error: 'La respuesta es obligatoria.' }

  const db = createAdminClient()
  if (id) {
    const { error } = await db.from('soporte_faq')
      .update({ modulo_clave, pregunta, respuesta, orden, activo, updated_at: new Date().toISOString() })
      .eq('id', Number(id))
    if (error) return { ok: false, error: 'Error al guardar la pregunta.' }
  } else {
    const { error } = await db.from('soporte_faq')
      .insert({ modulo_clave, pregunta, respuesta, orden, activo })
    if (error) return { ok: false, error: 'Error al crear la pregunta.' }
  }
  revalidatePath('/admin/soporte')
  return { ok: true }
}

export async function eliminarFaq(id: number): Promise<{ ok: boolean }> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return { ok: false }
  const { error } = await createAdminClient().from('soporte_faq').delete().eq('id', id)
  if (error) return { ok: false }
  revalidatePath('/admin/soporte')
  return { ok: true }
}

// ── Responder un mensaje de soporte ──────────────────────────────────────────
// Guarda la respuesta en el propio mensaje, lo marca RESUELTO y envía un email
// al cliente (from soporte@, Reply-To: soporte@) con el texto del admin dentro
// de la plantilla `respuesta_soporte` (marco de marca ya incluido).
export async function responderMensajeSoporte(
  id: number,
  texto: string,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return { ok: false, error: 'No autorizado.' }

  const respuesta = texto.trim()
  if (!respuesta) return { ok: false, error: 'La respuesta no puede estar vacía.' }

  const db = createAdminClient()
  const { data: msg } = await db
    .from('soporte_mensajes')
    .select('client_id, user_id, email, asunto')
    .eq('id', id)
    .maybeSingle()
  if (!msg) return { ok: false, error: 'Mensaje no encontrado.' }

  const { error } = await db
    .from('soporte_mensajes')
    .update({ respuesta, respuesta_at: new Date().toISOString(), estado: 'RESUELTO' })
    .eq('id', id)
  if (error) return { ok: false, error: 'No se pudo guardar la respuesta.' }

  if (msg.email && await tipoEmailActivo('respuesta_soporte')) {
    let nombre = msg.email
    if (msg.user_id) {
      const { data: usuario } = await db
        .from('client_users').select('nombre').eq('user_id', msg.user_id).maybeSingle()
      if (usuario?.nombre) nombre = usuario.nombre
    }
    const { asunto, html } = await renderPlantilla('respuesta_soporte', {
      nombre,
      asunto: msg.asunto,
      mensaje_admin: respuesta,
    })
    // El `from` va con el dominio verificado en Resend y no se toca; el `replyTo`
    // es dónde cae la respuesta del cliente, y ese sí sale del ajuste: si cambia
    // el buzón de soporte, las respuestas lo siguen sin desplegar.
    await enviarEmail({
      to: msg.email,
      from: 'CLAUX Soporte <soporte@claux.es>',
      replyTo: await leerCorreo('email_soporte'),
      subject: asunto,
      html,
      tipo: 'respuesta_soporte',
      clientId: msg.client_id,
    })
  }

  revalidatePath('/admin/soporte')
  return { ok: true }
}

// ── Borrador de respuesta con la IA interna ──────────────────────────────────
// Redacta un BORRADOR y lo devuelve: no toca el mensaje, no lo marca resuelto y
// no envía nada. Enviar sigue siendo un acto humano (`responderMensajeSoporte`).
// Consume la bolsa interna de CLAUX, no la del cliente.
export async function borradorRespuestaIa(
  id: number,
): Promise<{ ok: boolean; texto?: string; error?: string }> {
  await requirePermiso('soporte')
  if (!(await adminAutenticado())) return { ok: false, error: 'No autorizado.' }

  const db = createAdminClient()
  const { data: msg } = await db
    .from('soporte_mensajes')
    // `nombre_empresa` NO está aquí: vive en `clients` y se trae aparte, igual
    // que en `listarMensajesSoporte`. Pedirla en este select tumba la consulta
    // entera y el mensaje se vuelve «no encontrado».
    .select('client_id, asunto, mensaje, modulo_clave')
    .eq('id', id)
    .maybeSingle()
  if (!msg) return { ok: false, error: 'Mensaje no encontrado.' }

  const { data: cliente } = await db
    .from('clients').select('nombre_empresa').eq('client_id', msg.client_id).maybeSingle()

  // Las FAQ del módulo del que va el mensaje y las generales: son la única
  // fuente de verdad que le damos: sin ellas se inventa la plataforma.
  const claves = ['general', ...(msg.modulo_clave ? [msg.modulo_clave] : [])]
  const [{ data: faqs }, { data: modulo }] = await Promise.all([
    db.from('soporte_faq')
      .select('pregunta, respuesta')
      .in('modulo_clave', claves)
      .eq('activo', true)
      .order('orden'),
    msg.modulo_clave
      ? db.from('modulos_catalogo').select('nombre').eq('clave', msg.modulo_clave).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  try {
    const texto = await borradorSoporte({
      empresa:     cliente?.nombre_empresa ?? 'el cliente',
      asunto:      msg.asunto,
      mensaje:     msg.mensaje,
      faqs:        (faqs ?? []) as { pregunta: string; respuesta: string }[],
      moduloVenta: (modulo as { nombre?: string } | null)?.nombre ?? msg.modulo_clave,
    })
    if (!texto) return { ok: false, error: 'La IA no está disponible ahora mismo.' }
    return { ok: true, texto }
  } catch (e) {
    if (e instanceof IaBolsaAgotada) return { ok: false, error: e.message }
    throw e
  }
}
