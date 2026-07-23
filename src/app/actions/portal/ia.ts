'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { tieneModulo }       from '@/lib/modulos'
import { configAgente }      from '@/lib/ia/contexto'
import { generarInsight, responderChat, type TipoInsight, type TurnoChat } from '@/lib/ia/agente'
import { sugerirDatosItem, type SugerenciaItem } from '@/lib/ia/catalogo'
import { sugerirDescripcionProducto } from '@/lib/ia/producto'
import { sugerirSeccionDossier } from '@/lib/ia/dossier'
import { SECCIONES_RELATO } from '@/lib/dossier/secciones'
import { estadoDeResultados } from '@/lib/dossier/estado'
import type { FilaSerie } from '@/lib/dossier/snapshot'
import type { LineaDesglose } from '@/lib/dossier/base'
import { obtenerUsoMes, type UsoMes } from '@/lib/ia/uso'
import { IaNoConfigurada }   from '@/lib/ia/provider'
import { etiquetasDe, ETIQUETAS_DEFAULT } from '@/lib/sector'

// ── Tipos para historial ──
export interface ConversacionResumen {
  conversacion_id: string
  titulo: string
  created_at: string
  updated_at: string
  ultimo_mensaje?: string
}

export interface ConversacionCompleta {
  conversacion_id: string
  titulo: string
  mensajes: TurnoChat[]
}

// El addon de IA NO es un módulo del sidebar: se gatea en cada punto con
// tieneModulo('asistente_ia'). Helper común para todas las actions.
async function requireAddonIa(): Promise<{ clientId: string; nombreUsuario: string | null } | { error: string }> {
  const session = await getPortalSession()
  if (!session) return { error: 'Sin sesión.' }
  const db = createAdminClient()
  const [{ data: cliente }, { data: usuario }] = await Promise.all([
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).single(),
    db.from('client_users').select('nombre').eq('user_id', session.user_id).maybeSingle(),
  ])
  if (!tieneModulo(cliente?.modulos_activos, 'asistente_ia')) return { error: 'El asistente IA no está contratado.' }
  return { clientId: session.client_id, nombreUsuario: (usuario?.nombre as string | null) ?? null }
}

function mensajeError(e: unknown): string {
  if (e instanceof IaNoConfigurada) return 'El asistente aún no está configurado. Inténtalo más tarde.'
  return 'No pude generar la respuesta ahora mismo. Inténtalo de nuevo en un momento.'
}

export type IaRespuesta = { ok: true; texto: string } | { ok: false; error: string }

// ── Insights puntuales (touchpoints) ──
export async function generarInsightIa(tipo: TipoInsight): Promise<IaRespuesta> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }
  try {
    const texto = await generarInsight(guard.clientId, tipo, guard.nombreUsuario)
    return { ok: true, texto }
  } catch (e) {
    console.error('[ia] generarInsight', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Chat libre del dueño (botón flotante) ──
export async function chatAgenteIa(historial: TurnoChat[], mensaje: string): Promise<IaRespuesta> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }
  const texto0 = (mensaje ?? '').trim()
  if (!texto0) return { ok: false, error: 'Escribe un mensaje.' }
  try {
    const hist = Array.isArray(historial) ? historial.slice(-8) : []
    const texto = await responderChat(guard.clientId, hist, texto0, guard.nombreUsuario)
    return { ok: true, texto }
  } catch (e) {
    console.error('[ia] chatAgente', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Autocompletar ficha de un ítem del Catálogo (IA de cara al dueño) ──
export type IaSugerenciaItem = { ok: true; sugerencia: SugerenciaItem } | { ok: false; error: string }

export async function autocompletarItemCatalogo(nombre: string): Promise<IaSugerenciaItem> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }
  const nombre0 = (nombre ?? '').trim()
  if (!nombre0) return { ok: false, error: 'Escribe primero el nombre del producto.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('sector').eq('client_id', guard.clientId).single()
  const sector = (cli?.sector as string | null) ?? null

  let etiquetaCatalogo = ETIQUETAS_DEFAULT.catalogo
  if (sector) {
    const { data: pl } = await db.from('plantillas_sector').select('etiquetas').eq('sector', sector).maybeSingle()
    etiquetaCatalogo = etiquetasDe(pl?.etiquetas).catalogo
  }

  try {
    const sugerencia = await sugerirDatosItem(guard.clientId, nombre0, etiquetaCatalogo, sector)
    if (!sugerencia) return { ok: false, error: 'No pude generar sugerencias ahora mismo. Inténtalo de nuevo.' }
    return { ok: true, sugerencia }
  } catch (e) {
    console.error('[ia] autocompletarItemCatalogo', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Sugerir descripción de un producto/servicio (IA de cara al dueño) ──
export type IaSugerenciaTexto = { ok: true; texto: string } | { ok: false; error: string }

export async function autocompletarDescripcionProducto(nombre: string, esServicio: boolean): Promise<IaSugerenciaTexto> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }
  const nombre0 = (nombre ?? '').trim()
  if (!nombre0) return { ok: false, error: 'Escribe primero el nombre.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('sector').eq('client_id', guard.clientId).single()

  try {
    const texto = await sugerirDescripcionProducto(guard.clientId, nombre0, esServicio, (cli?.sector as string | null) ?? null)
    if (!texto) return { ok: false, error: 'No pude sugerir una descripción ahora mismo. Inténtalo de nuevo.' }
    return { ok: true, texto }
  } catch (e) {
    console.error('[ia] autocompletarDescripcionProducto', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Redactar una sección del relato del Dossier (IA de cara al dueño) ──
// Vive aquí y no en dossier.ts porque `requireAddonIa` es privado: en un fichero
// 'use server' todo export es una server action pública, así que el gate no puede
// exportarse. Meter la action donde vive el gate lo mantiene en UN sitio (la
// alternativa era duplicar el tieneModulo(…,'asistente_ia'), como citas/reservas).
export type IaSugerenciaSeccion = { ok: true; cuerpo: string } | { ok: false; error: string }

export async function redactarSeccionDossier(clave: string): Promise<IaSugerenciaSeccion> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const espec = SECCIONES_RELATO.find(s => s.clave === clave)
  if (!espec) return { ok: false, error: 'Sección desconocida.' }

  const db = createAdminClient()
  const [{ data: cli }, { data: dos }] = await Promise.all([
    db.from('clients').select('sector, nombre_empresa').eq('client_id', guard.clientId).single(),
    db.from('dossiers').select('dossier_id, moneda_presentacion')
      .eq('client_id', guard.clientId).order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ])
  if (!dos) return { ok: false, error: 'Crea primero tu dossier.' }

  const [{ data: serieRows }, { data: lineaRows }, { data: seccionRows }] = await Promise.all([
    db.from('dossier_serie').select('mes, ingresos, costo_ventas, gastos_operativos, moneda, origen')
      .eq('dossier_id', dos.dossier_id).eq('client_id', guard.clientId).order('mes'),
    db.from('dossier_lineas').select('grupo, concepto, monto, orden')
      .eq('dossier_id', dos.dossier_id).eq('client_id', guard.clientId).order('orden'),
    db.from('dossier_secciones').select('clave, cuerpo')
      .eq('dossier_id', dos.dossier_id).eq('client_id', guard.clientId).order('orden'),
  ])

  const serie: FilaSerie[] = (serieRows ?? []).map((r: Record<string, unknown>) => ({
    mes: r.mes as string,
    ingresos: Number(r.ingresos), costo_ventas: Number(r.costo_ventas), gastos_operativos: Number(r.gastos_operativos),
    moneda: r.moneda as string, origen: (r.origen === 'BASE' ? 'BASE' : 'MANUAL'),
  }))
  const lineas: LineaDesglose[] = (lineaRows ?? []).map((r: Record<string, unknown>) => ({
    grupo: r.grupo as LineaDesglose['grupo'], concepto: r.concepto as string, monto: Number(r.monto), orden: Number(r.orden),
  }))

  // El CÓDIGO calcula las cifras; la IA solo las redacta. Ver la regla dura en lib/ia/dossier.ts.
  const er = estadoDeResultados(serie, lineas)
  const cifras = serie.length > 0
    ? { ingresos: er.ingresos, margenBrutoPct: er.margenBrutoPct, resultadoNeto: er.resultadoNeto, meses: serie.length }
    : null

  const otras = (seccionRows ?? [])
    .map((r: Record<string, unknown>) => ({ clave: r.clave as string, cuerpo: ((r.cuerpo as string) ?? '').trim() }))
    .filter(s => s.clave !== clave && s.cuerpo.length > 0)
    .map(s => ({ etiqueta: SECCIONES_RELATO.find(e => e.clave === s.clave)?.etiqueta ?? s.clave, cuerpo: s.cuerpo }))

  try {
    const sug = await sugerirSeccionDossier(guard.clientId, espec, {
      negocio: (cli?.nombre_empresa as string) || 'Mi negocio',
      sector: (cli?.sector as string | null) ?? null,
      moneda: dos.moneda_presentacion as string,
      cifras,
      otras,
    })
    if (!sug?.cuerpo) return { ok: false, error: 'No pude generar un borrador ahora mismo. Inténtalo de nuevo.' }
    return { ok: true, cuerpo: sug.cuerpo }
  } catch (e) {
    console.error('[ia] redactarSeccionDossier', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Consumo del cliente (sección informativa de Perfil) ──
// El nombre/tono del agente son globales (admin); el cliente solo VE su consumo.
export interface IaPanel { nombreAgente: string; uso: UsoMes }

export async function obtenerPanelIa(): Promise<IaPanel | null> {
  const guard = await requireAddonIa()
  if ('error' in guard) return null
  const [{ nombreAgente }, uso] = await Promise.all([configAgente(), obtenerUsoMes(guard.clientId)])
  return { nombreAgente, uso }
}

// ── Historial de conversaciones ──

// Guardar una conversación completa (nueva o existente)
export async function guardarConversacion(
  conversacionId: string | null,
  titulo: string,
  mensajes: TurnoChat[]
): Promise<{ ok: boolean; error?: string; conversacion_id?: string }> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()

  // Generar ID si es nueva
  const convId = conversacionId ?? `CONV-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`

  // Insertar o actualizar conversación
  const { error: convError } = await db.from('ia_conversaciones').upsert({
    conversacion_id: convId,
    client_id: guard.clientId,
    user_id: guard.clientId, // Usamos clientId como user_id del portal
    titulo: titulo || 'Nueva conversación',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'conversacion_id' })

  if (convError) return { ok: false, error: convError.message }

  // Borrar mensajes anteriores y insertar los nuevos
  await db.from('ia_mensajes').delete().eq('conversacion_id', convId)

  if (mensajes.length > 0) {
    const mensajesToInsert = mensajes.map(m => ({
      mensaje_id: `MSG-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`,
      conversacion_id: convId,
      rol: m.rol,
      contenido: m.texto,
    }))

    const { error: msgError } = await db.from('ia_mensajes').insert(mensajesToInsert)
    if (msgError) return { ok: false, error: msgError.message }
  }

  return { ok: true, conversacion_id: convId }
}

// Obtener lista de conversaciones del usuario
export async function obtenerConversaciones(): Promise<{ ok: boolean; error?: string; conversaciones?: ConversacionResumen[] }> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()

  const { data, error } = await db.from('ia_conversaciones')
    .select('conversacion_id, titulo, created_at, updated_at')
    .eq('client_id', guard.clientId)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) return { ok: false, error: error.message }

  const conversaciones: ConversacionResumen[] = (data ?? []).map(c => ({
    conversacion_id: c.conversacion_id,
    titulo: c.titulo,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }))

  return { ok: true, conversaciones }
}

// Obtener mensajes de una conversación específica
export async function obtenerMensajesConversacion(
  conversacionId: string
): Promise<{ ok: boolean; error?: string; conversacion?: ConversacionCompleta }> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()

  const { data: convData, error: convError } = await db.from('ia_conversaciones')
    .select('conversacion_id, titulo')
    .eq('conversacion_id', conversacionId)
    .eq('client_id', guard.clientId)
    .single()

  if (convError || !convData) return { ok: false, error: 'Conversación no encontrada' }

  const { data: msgData, error: msgError } = await db.from('ia_mensajes')
    .select('rol, contenido')
    .eq('conversacion_id', conversacionId)
    .order('created_at', { ascending: true })

  if (msgError) return { ok: false, error: msgError.message }

  const mensajes: TurnoChat[] = (msgData ?? []).map(m => ({
    rol: m.rol as 'user' | 'assistant',
    texto: m.contenido,
  }))

  return {
    ok: true,
    conversacion: {
      conversacion_id: convData.conversacion_id,
      titulo: convData.titulo,
      mensajes,
    }
  }
}

// Eliminar una conversación
export async function eliminarConversacion(
  conversacionId: string
): Promise<{ ok: boolean; error?: string }> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const db = createAdminClient()

  const { error } = await db.from('ia_conversaciones')
    .delete()
    .eq('conversacion_id', conversacionId)
    .eq('client_id', guard.clientId)

  if (error) return { ok: false, error: error.message }

  return { ok: true }
}
