'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { tieneModulo }       from '@/lib/modulos'
import { configAgente }      from '@/lib/ia/contexto'
import { generarInsight, responderChat, type TipoInsight, type TurnoChat } from '@/lib/ia/agente'
import { obtenerUsoMes, type UsoMes } from '@/lib/ia/uso'
import { IaNoConfigurada }   from '@/lib/ia/provider'

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

// ── Consumo del cliente (sección informativa de Perfil) ──
// El nombre/tono del agente son globales (admin); el cliente solo VE su consumo.
export interface IaPanel { nombreAgente: string; uso: UsoMes }

export async function obtenerPanelIa(): Promise<IaPanel | null> {
  const guard = await requireAddonIa()
  if ('error' in guard) return null
  const [{ nombreAgente }, uso] = await Promise.all([configAgente(), obtenerUsoMes(guard.clientId)])
  return { nombreAgente, uso }
}
