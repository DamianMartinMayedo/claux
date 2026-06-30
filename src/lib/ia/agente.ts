// ── Agente del dueño (análisis e insights del negocio) ──
// Construye el agente acotado al tenant y responde, ya sea un insight puntual
// (botón/tooltip por módulo) o el chat libre del botón flotante. El system prompt
// lleva la identidad (nombre del agente, negocio) y le PROHÍBE inventar datos
// fuera del contexto que se le pasa. Mide el consumo en cada llamada.

import { chat, type IaMensaje } from './provider'
import { registrarUso } from './uso'
import { construirContexto, contextoComoTexto, type ContextoNegocio } from './contexto'

export type TipoInsight = 'ventas' | 'gastos' | 'proyeccion' | 'general'

function systemPrompt(ctx: ContextoNegocio): string {
  return [
    `Eres ${ctx.nombreAgente}, el asistente de IA del negocio "${ctx.nombreEmpresa}".`,
    `Hablas en español, con tono ${ctx.tono}, claro y breve. Te diriges al dueño del negocio.`,
    'Respondes SOLO con la información del contexto JSON que se te entrega (son datos reales y ya agregados de ESTE negocio).',
    'Si la pregunta requiere datos que no están en el contexto, dilo con honestidad y sugiere qué módulo lo aportaría; nunca inventes cifras.',
    'No mezcles importes de monedas distintas en una sola cifra. Usa los datos de cada moneda por separado y, si existe, el consolidado.',
    'Da conclusiones accionables (qué está pasando y qué conviene hacer), no listados de números crudos.',
  ].join(' ')
}

const PROMPTS_INSIGHT: Record<TipoInsight, string> = {
  ventas:     'Analiza la evolución de mis VENTAS de los últimos 6 meses: tendencia, mejor y peor mes, y una recomendación. Máximo 5 frases.',
  gastos:     'Analiza mis GASTOS de los últimos 6 meses: tendencia, posibles anomalías y dónde podría ahorrar. Máximo 5 frases.',
  proyeccion: 'Proyecta mis ingresos y resultado del próximo mes según la tendencia reciente, indicando el supuesto usado. Sé prudente. Máximo 5 frases.',
  general:    'Dame un análisis general de la salud de mi negocio con lo más relevante de ventas, gastos, caja y agenda, y 1-2 acciones prioritarias. Máximo 6 frases.',
}

const FOCO: Record<TipoInsight, 'ventas' | 'gastos' | 'general'> = {
  ventas: 'ventas', gastos: 'gastos', proyeccion: 'ventas', general: 'general',
}

// Insight puntual disparado desde un touchpoint. Cuenta como conversación nueva.
export async function generarInsight(clientId: string, tipo: TipoInsight): Promise<string> {
  const ctx = await construirContexto(clientId)
  const contexto = contextoComoTexto(ctx, FOCO[tipo])
  const mensajes: IaMensaje[] = [
    { role: 'system', content: systemPrompt(ctx) },
    { role: 'user', content: `Contexto del negocio (JSON):\n${contexto}\n\nTarea: ${PROMPTS_INSIGHT[tipo]}` },
  ]
  const { texto, usage } = await chat({ mensajes, maxTokens: 1400 })
  await registrarUso(clientId, usage, true)
  return texto
}

export interface TurnoChat { rol: 'user' | 'assistant'; texto: string }

// Chat libre del dueño (botón flotante). `historial` son los turnos previos de la
// MISMA conversación; solo el primer turno cuenta como conversación nueva.
export async function responderChat(clientId: string, historial: TurnoChat[], mensaje: string): Promise<string> {
  const ctx = await construirContexto(clientId)
  const contexto = contextoComoTexto(ctx, 'general')
  const mensajes: IaMensaje[] = [
    { role: 'system', content: `${systemPrompt(ctx)}\n\nContexto del negocio (JSON):\n${contexto}` },
    ...historial.map<IaMensaje>(t => ({ role: t.rol, content: t.texto })),
    { role: 'user', content: mensaje },
  ]
  const { texto, usage } = await chat({ mensajes, maxTokens: 1400 })
  await registrarUso(clientId, usage, historial.length === 0)
  return texto
}
