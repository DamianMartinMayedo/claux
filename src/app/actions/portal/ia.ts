'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { tieneModulo }       from '@/lib/modulos'
import { leerIaConfig }      from '@/lib/ia/contexto'
import { generarInsight, responderChat, type TipoInsight, type TurnoChat } from '@/lib/ia/agente'
import { obtenerUsoMes, type UsoMes } from '@/lib/ia/uso'
import { IaNoConfigurada }   from '@/lib/ia/provider'

// El addon de IA NO es un módulo del sidebar: se gatea en cada punto con
// tieneModulo('asistente_ia'). Helper común para todas las actions.
async function requireAddonIa(): Promise<{ clientId: string } | { error: string }> {
  const session = await getPortalSession()
  if (!session) return { error: 'Sin sesión.' }
  const db = createAdminClient()
  const { data: cliente } = await db
    .from('clients').select('modulos_activos').eq('client_id', session.client_id).single()
  if (!tieneModulo(cliente?.modulos_activos, 'asistente_ia')) return { error: 'El asistente IA no está contratado.' }
  return { clientId: session.client_id }
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
    const texto = await generarInsight(guard.clientId, tipo)
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
    const texto = await responderChat(guard.clientId, hist, texto0)
    return { ok: true, texto }
  } catch (e) {
    console.error('[ia] chatAgente', e)
    return { ok: false, error: mensajeError(e) }
  }
}

// ── Config del agente (sección de Perfil) ──
export interface IaPanel { nombreAgente: string; tono: string; uso: UsoMes }

export async function obtenerPanelIa(): Promise<IaPanel | null> {
  const guard = await requireAddonIa()
  if ('error' in guard) return null
  const db = createAdminClient()
  const { data: cliente } = await db
    .from('clients').select('ia_config').eq('client_id', guard.clientId).single()
  const { nombreAgente, tono } = leerIaConfig(cliente?.ia_config)
  const uso = await obtenerUsoMes(guard.clientId)
  return { nombreAgente, tono, uso }
}

export async function guardarIaConfig(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const guard = await requireAddonIa()
  if ('error' in guard) return { ok: false, error: guard.error }

  const nombre = ((formData.get('nombre_agente') as string) ?? '').trim().slice(0, 40)
  const tono   = ((formData.get('tono')          as string) ?? '').trim().slice(0, 60)

  const db = createAdminClient()
  // Merge sobre el jsonb existente para no pisar otras claves (canales, etc.).
  const { data: row } = await db.from('clients').select('ia_config').eq('client_id', guard.clientId).single()
  const actual = (row?.ia_config && typeof row.ia_config === 'object') ? row.ia_config as Record<string, unknown> : {}
  const nuevo = { ...actual, nombre_agente: nombre || null, tono: tono || null }

  const { error } = await db.from('clients').update({ ia_config: nuevo }).eq('client_id', guard.clientId)
  if (error) return { ok: false, error: 'No se pudo guardar.' }

  revalidatePath('/portal/perfil')
  return { ok: true }
}
