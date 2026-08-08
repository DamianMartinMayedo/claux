'use server'

// ── Ajustes del NEGOCIO que comparten Reservas y Citas ────────────────────────
//
// Reservas (aforo, clave `reservas_citas`) y Citas (agenda, clave `agenda`) son dos
// funcionalidades que se venden por separado, pero tres cosas de su pantalla de
// Configuración no son de ninguna de las dos: son del negocio entero.
//
//   · el slug     → la dirección pública (`/[slug]/reservar`, `/[slug]/citas`) y
//                   también la del catálogo QR: una sola columna `clients.slug`.
//   · los cierres → «el 24 cerramos» no cierra las mesas y deja abiertas las citas.
//   · las reglas  → antelación y ventana, columnas de `clients`.
//
// Vivían en `reservas.ts` bajo `puedeEditarModulo('reservas_citas')`, así que un
// cliente con SOLO `agenda` —la peluquería, o sea el caso canónico de Citas— recibía
// «No tienes permiso para editar en este módulo» al guardar su enlace público. Sin
// slug no existe `/[slug]/citas`: la mitad pública de lo que pagó no arrancaba.
// El candado correcto es «alguna de las dos», el mismo patrón que ya usan los
// terceros compartidos entre módulos.

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarAlgunModulo, puedeEditarModulo } from './auth'
import { parseBotConfig, urlWebhookDe, type BotColumna } from '@/lib/reservas/bot-config'
import { enviarMensaje } from '@/lib/telegram/enviar'

// Las dos funcionalidades de la agenda. El slug suma el catálogo QR: es la misma
// columna y también es la dirección del menú público.
const MODULOS_AGENDA = ['reservas_citas', 'agenda']
const MODULOS_SLUG   = ['reservas_citas', 'agenda', 'catalogo_qr']

const SIN_PERMISO = 'No tienes permiso para editar en este módulo.'

// Cada bot es de SU funcionalidad, y su candado también.
const MODULO_DE_COLUMNA: Record<BotColumna, string> = {
  bot_config:       'reservas_citas',
  bot_config_citas: 'agenda',
}
const RUTA_DE_COLUMNA: Record<BotColumna, string> = {
  bot_config:       '/portal/reservas',
  bot_config_citas: '/portal/citas',
}

function generarCierreId(): string {
  return `CIE-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

function normalizarSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

// ── Tipos compartidos ─────────────────────────────────────────────────────────

export interface Cierre {
  cierre_id:   string
  fecha_desde: string
  fecha_hasta: string
  motivo:      string | null
}

export interface ReglasReserva {
  antelacion_min_horas: number
  ventana_max_dias:     number
  max_personas:         number
}

/**
 * Respuesta de las RPC de alta y edición de la agenda.
 *
 * `forzable` marca los rechazos que el DUEÑO puede saltarse (aforo, antelación,
 * cierre, horario…) frente a los de integridad, que no se salta nadie. Lo decide la
 * base y no el panel: adivinarlo comparando cadenas de error es cómo se acaba
 * ofreciendo «añadir igualmente» sobre un turno que no existe.
 * `avisos` es lo que SÍ se saltó, en texto, para poder enseñarlo después.
 */
export interface ResultadoAgenda {
  ok:        boolean
  error?:    string
  forzable?: boolean
  avisos?:   string[]
}

// ── Enlace público (slug) ─────────────────────────────────────────────────────

/**
 * Única implementación del slug. Antes había dos —una en `reservas.ts` y otra en
 * `catalogo.ts`— con candados distintos sobre la MISMA columna, así que el mismo
 * cambio pasaba o no según la pantalla desde la que se hiciera.
 */
export async function guardarSlug(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)                                          return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(MODULOS_SLUG)))     return { ok: false, error: SIN_PERMISO }

  const db = createAdminClient()

  // El slug ANTERIOR hace falta para invalidar también la web vieja: si no, tras
  // cambiarlo se seguiría sirviendo cacheada la de antes.
  const { data: actual } = await db.from('clients')
    .select('slug').eq('client_id', session.client_id).maybeSingle()
  const anterior = (actual?.slug as string | null) ?? null

  const slugRaw = ((formData.get('slug') as string) ?? '').trim()

  let slug: string | null = null
  if (slugRaw) {
    slug = normalizarSlug(slugRaw)
    if (!slug || slug.length < 2) return { ok: false, error: 'Mínimo 2 caracteres (letras, números o guiones).' }

    const { data: existente } = await db.from('clients')
      .select('client_id')
      .eq('slug', slug)
      .neq('client_id', session.client_id)
      .maybeSingle()
    if (existente) return { ok: false, error: 'Ese enlace ya lo está usando otro negocio.' }
  }

  const { error } = await db.from('clients')
    .update({ slug })
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  // Las tres pantallas del portal que enseñan el enlace, y las tres rutas públicas
  // que cuelgan de él (con el slug viejo y el nuevo).
  revalidatePath('/portal/reservas')
  revalidatePath('/portal/citas')
  revalidatePath('/portal/catalogo')
  for (const s of new Set([anterior, slug].filter(Boolean) as string[])) {
    revalidatePath(`/${s}/reservar`)
    revalidatePath(`/${s}/citas`)
    revalidatePath(`/${s}/catalogo`)
  }
  return { ok: true }
}

// ── Cierres / festivos ────────────────────────────────────────────────────────

export async function guardarCierre(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)                                        return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(MODULOS_AGENDA))) return { ok: false, error: SIN_PERMISO }

  const desde    = (formData.get('fecha_desde') as string)?.trim()
  const hastaRaw = (formData.get('fecha_hasta') as string)?.trim()
  const motivo   = (formData.get('motivo')      as string)?.trim() || null
  if (!desde) return { ok: false, error: 'La fecha es obligatoria.' }
  const hasta = hastaRaw || desde
  if (hasta < desde) return { ok: false, error: 'La fecha final no puede ser anterior a la inicial.' }

  const db = createAdminClient()
  const { error } = await db.from('reserva_cierres').insert({
    cierre_id: generarCierreId(), client_id: session.client_id, fecha_desde: desde, fecha_hasta: hasta, motivo,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/reservas')
  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function eliminarCierre(cierre_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)                                        return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(MODULOS_AGENDA))) return { ok: false, error: SIN_PERMISO }

  const db = createAdminClient()
  const { error } = await db.from('reserva_cierres').delete()
    .eq('cierre_id', cierre_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/reservas')
  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Reglas de reserva ─────────────────────────────────────────────────────────

export async function guardarReglas(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)                                        return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarAlgunModulo(MODULOS_AGENDA))) return { ok: false, error: SIN_PERMISO }

  const ent = (k: string) => {
    const n = parseInt(formData.get(k) as string, 10)
    return isNaN(n) || n < 0 ? 0 : n
  }

  const db = createAdminClient()
  const { error } = await db.from('clients').update({
    reserva_antelacion_min_horas: ent('antelacion_min_horas'),
    reserva_ventana_max_dias:     ent('ventana_max_dias'),
    reserva_max_personas:         ent('max_personas'),
  }).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/reservas')
  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Diagnóstico del bot de Telegram (fase 7) ──────────────────────────────────
//
// El estado de la tarjeta era `webhook_registrado`, un booleano guardado el día del
// alta: decía lo que pasó entonces, no lo que pasa ahora. Y como `guardarBotConfigCol`
// corta antes de `setWebhook` cuando nada cambió, volver a pulsar «Guardar» no
// reintentaba nada — la única salida era borrar el bot y rehacerlo, perdiendo el
// código de vínculo y el chat del dueño.
//
// Telegram GUARDA la URL del webhook, no la recalcula: cambiar la variable de entorno
// no arregla los bots ya registrados. Por eso «Reparar» existe.

export interface DiagnosticoWebhook {
  ok:                    boolean
  error?:                string
  /** Lo que Telegram tiene registrado AHORA. Vacío = ninguno. */
  url:                   string
  /** Lo que debería tener. */
  esperada:              string
  coincide:              boolean
  pending_update_count:  number
  last_error_message:    string | null
  /** Chat del dueño vinculado (`/start <código>`). Sin esto no le llega nada. */
  chat_vinculado:        boolean
}

const SIN_DIAGNOSTICO: Omit<DiagnosticoWebhook, 'ok' | 'error'> = {
  url: '', esperada: '', coincide: false,
  pending_update_count: 0, last_error_message: null, chat_vinculado: false,
}

async function botDe(columna: BotColumna, clientId: string) {
  const db = createAdminClient()
  const { data } = await db.from('clients').select(columna).eq('client_id', clientId).single()
  return parseBotConfig((data as Record<string, unknown> | null)?.[columna])
}

export async function comprobarWebhook(columna: BotColumna): Promise<DiagnosticoWebhook> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.', ...SIN_DIAGNOSTICO }
  if (!(await puedeEditarModulo(MODULO_DE_COLUMNA[columna]))) {
    return { ok: false, error: SIN_PERMISO, ...SIN_DIAGNOSTICO }
  }

  const cfg = await botDe(columna, session.client_id)
  if (!cfg.token) return { ok: false, error: 'No hay un bot configurado.', ...SIN_DIAGNOSTICO }

  const esperada = urlWebhookDe(cfg.token)
  if (!esperada) {
    return { ok: false, error: 'Falta configurar el dominio del sistema. Avisa a soporte.', ...SIN_DIAGNOSTICO }
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/getWebhookInfo`)
    const json = await res.json() as {
      ok?: boolean
      result?: { url?: string; pending_update_count?: number; last_error_message?: string }
      description?: string
    }
    if (!json.ok || !json.result) {
      return { ok: false, error: json.description ?? 'Telegram no respondió.', ...SIN_DIAGNOSTICO, esperada }
    }
    const url = json.result.url ?? ''
    return {
      ok: true,
      url,
      esperada,
      coincide:             url === esperada,
      pending_update_count: json.result.pending_update_count ?? 0,
      last_error_message:   json.result.last_error_message ?? null,
      chat_vinculado:       !!cfg.notificar_owner_chat_id,
    }
  } catch {
    return { ok: false, error: 'No se pudo conectar con Telegram.', ...SIN_DIAGNOSTICO, esperada }
  }
}

/** Vuelve a registrar el webhook con la URL correcta. Sin borrar nada del bot. */
export async function repararWebhook(columna: BotColumna): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo(MODULO_DE_COLUMNA[columna]))) return { ok: false, error: SIN_PERMISO }

  const db  = createAdminClient()
  const cfg = await botDe(columna, session.client_id)
  if (!cfg.token) return { ok: false, error: 'No hay un bot configurado.' }

  const url = urlWebhookDe(cfg.token)
  if (!url) return { ok: false, error: 'Falta configurar el dominio del sistema. Avisa a soporte.' }

  // El secreto se conserva si ya existía: cambiarlo dejaría fuera a los updates en
  // vuelo, y no hace falta para reparar la URL.
  const secreto = cfg.webhook_secret ?? crypto.randomUUID().replace(/-/g, '')

  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/setWebhook`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url, secret_token: secreto, allowed_updates: ['message', 'callback_query'] }),
    })
    const json = await res.json() as { ok?: boolean; description?: string }
    if (!json.ok) return { ok: false, error: json.description ?? 'Telegram rechazó el registro.' }
  } catch {
    return { ok: false, error: 'No se pudo conectar con Telegram.' }
  }

  await db.from('clients')
    .update({ [columna]: { ...cfg, webhook_secret: secreto, webhook_registrado: true } })
    .eq('client_id', session.client_id)

  revalidatePath(RUTA_DE_COLUMNA[columna])
  return { ok: true }
}

/**
 * Aviso de prueba al chat del dueño (TG-3).
 *
 * Es lo único que convierte «creo que está avisado» en «está avisado»: un cliente que
 * guardó el token, no hizo el `/start <código>` y se fue, cree que le llegan los
 * avisos y no le llega ninguno — y nada se lo dice.
 */
export async function enviarPruebaBot(columna: BotColumna): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo(MODULO_DE_COLUMNA[columna]))) return { ok: false, error: SIN_PERMISO }

  const cfg = await botDe(columna, session.client_id)
  if (!cfg.token)  return { ok: false, error: 'No hay un bot configurado.' }
  if (!cfg.activo) return { ok: false, error: 'El bot está desactivado.' }
  if (!cfg.notificar_owner_chat_id) {
    return { ok: false, error: `Tu chat no está vinculado. Abre el bot en Telegram y escribe: /start ${cfg.codigo_vinculo ?? ''}` }
  }

  const qué = columna === 'bot_config' ? 'reservas' : 'citas'
  const enviado = await enviarMensaje(
    cfg.token,
    cfg.notificar_owner_chat_id,
    `🔔 Prueba de CLAUX\nSi lees esto, los avisos de ${qué} te llegan bien por aquí.`,
    undefined,
    { clientId: session.client_id, columna, tipo: 'prueba' },
  )
  if (!enviado) {
    return { ok: false, error: 'Telegram no aceptó el mensaje. Puede que hayas bloqueado el bot o que el token ya no valga.' }
  }
  return { ok: true }
}

// ── Historial del cliente (11.2) ──────────────────────────────────────────────
//
// `nombre_cliente` y `telefono` son texto libre: no hay ficha, ni historial, ni «este
// ya faltó dos veces». En una peluquería, saber que quien pide cita viene desde hace
// dos años —o que no se presentó las dos últimas— es la mitad del valor del módulo.
//
// Versión mínima a propósito: **sin tabla nueva, sin ficha y sin vínculo con Terceros**
// (eso rompería la independencia de módulos y vive en la ficha G4 del backlog).

export interface HistorialCliente {
  visitas:  number
  no_shows: number
}

/**
 * Se cruza por TELÉFONO NORMALIZADO —solo dígitos, últimos 8— que es lo que sobrevive
 * a que el mismo cliente escriba `+53 5…` una vez y `5…` la siguiente. Por nombre no:
 * dos «Ana» no son la misma persona, y ese error ya se cometió con los terceros.
 */
export async function historialCliente(telefono: string | null): Promise<HistorialCliente> {
  const vacio: HistorialCliente = { visitas: 0, no_shows: 0 }
  const session = await getPortalSession()
  if (!session || !telefono) return vacio

  const clave = telefono.replace(/\D/g, '').slice(-8)
  if (clave.length < 6) return vacio

  const db = createAdminClient()
  const { data } = await db.from('reservas')
    .select('estado, telefono')
    .eq('client_id', session.client_id)
    .not('telefono', 'is', null)
    .in('estado', ['ATENDIDA', 'NO_SHOW'])
    .limit(500)

  const filas = ((data ?? []) as { estado: string; telefono: string | null }[])
    .filter(r => (r.telefono ?? '').replace(/\D/g, '').slice(-8) === clave)

  return {
    visitas:  filas.filter(r => r.estado === 'ATENDIDA').length,
    no_shows: filas.filter(r => r.estado === 'NO_SHOW').length,
  }
}
