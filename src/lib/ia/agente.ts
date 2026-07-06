// ── Agente del dueño (análisis e insights del negocio) ──
// Construye el agente acotado al tenant y responde, ya sea un insight puntual
// (botón/tooltip por módulo) o el chat libre del botón flotante. El system prompt
// lleva la identidad (nombre del agente, negocio) y le PROHÍBE inventar datos
// fuera del contexto que se le pasa. Mide el consumo en cada llamada.

import { chat, type IaMensaje } from './provider'
import { registrarUso } from './uso'
import { createAdminClient } from '@/lib/supabase/admin'
import { construirContexto, contextoComoTexto, type ContextoNegocio } from './contexto'
import { PROMPTS_INSIGHT_DEFAULT, claveSeccion, type TipoInsight } from './documentos'

export type { TipoInsight }

const FALLBACK_VACIO = 'No pude generar el análisis ahora mismo. Vuelve a intentarlo en un momento.'

// El system prompt es el documento de personalidad editable desde el admin
// (ctx.instrucciones), con los placeholders rellenados. Ver INSTRUCCIONES_DEFAULT.
function systemPrompt(ctx: ContextoNegocio): string {
  return ctx.instrucciones
    .replaceAll('{{agente}}',  ctx.nombreAgente)
    .replaceAll('{{negocio}}', ctx.nombreEmpresa)
    .replaceAll('{{usuario}}', ctx.nombreUsuario || 'el dueño del negocio')
    .replaceAll('{{tono}}',    ctx.tono)
}

const FOCO: Record<TipoInsight, 'ventas' | 'gastos' | 'general' | 'catalogo'> = {
  ventas: 'ventas', gastos: 'gastos', proyeccion: 'ventas', general: 'general',
  inventario: 'general', rrhh: 'general', tesoreria: 'general', catalogo: 'catalogo',
}

// Prompt de tarea de la sección: editable desde el admin (settings), con fallback
// al valor por defecto del registro de documentos.
async function promptSeccion(tipo: TipoInsight): Promise<string> {
  const db = createAdminClient()
  const { data } = await db.from('settings').select('value').eq('key', claveSeccion(tipo)).maybeSingle()
  return (data?.value || '').trim() || PROMPTS_INSIGHT_DEFAULT[tipo]
}

// Insight puntual disparado desde un touchpoint. Cuenta como conversación nueva.
export async function generarInsight(clientId: string, tipo: TipoInsight, nombreUsuario?: string | null): Promise<string> {
  const [ctx, tarea] = await Promise.all([construirContexto(clientId, nombreUsuario), promptSeccion(tipo)])
  const contexto = contextoComoTexto(ctx, FOCO[tipo])
  const mensajes: IaMensaje[] = [
    { role: 'system', content: systemPrompt(ctx) },
    { role: 'user', content: `Contexto del negocio (JSON):\n${contexto}\n\nTarea: ${tarea}` },
  ]
  const { texto, usage } = await chat({ mensajes, maxTokens: 3000, clientId })
  await registrarUso(clientId, usage, true)
  return texto.trim() || FALLBACK_VACIO
}

export interface TurnoChat { rol: 'user' | 'assistant'; texto: string }

// Chat libre del dueño (botón flotante). `historial` son los turnos previos de la
// MISMA conversación; solo el primer turno cuenta como conversación nueva.
export async function responderChat(clientId: string, historial: TurnoChat[], mensaje: string, nombreUsuario?: string | null): Promise<string> {
  const ctx = await construirContexto(clientId, nombreUsuario)
  const contexto = contextoComoTexto(ctx, 'general')
  const mensajes: IaMensaje[] = [
    { role: 'system', content: `${systemPrompt(ctx)}\n\nContexto del negocio (JSON):\n${contexto}` },
    ...historial.map<IaMensaje>(t => ({ role: t.rol, content: t.texto })),
    { role: 'user', content: mensaje },
  ]
  const { texto, usage } = await chat({ mensajes, maxTokens: 2200, clientId })
  await registrarUso(clientId, usage, historial.length === 0)
  return texto.trim() || FALLBACK_VACIO
}
