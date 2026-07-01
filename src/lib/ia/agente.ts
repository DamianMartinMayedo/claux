// ── Agente del dueño (análisis e insights del negocio) ──
// Construye el agente acotado al tenant y responde, ya sea un insight puntual
// (botón/tooltip por módulo) o el chat libre del botón flotante. El system prompt
// lleva la identidad (nombre del agente, negocio) y le PROHÍBE inventar datos
// fuera del contexto que se le pasa. Mide el consumo en cada llamada.

import { chat, type IaMensaje } from './provider'
import { registrarUso } from './uso'
import { construirContexto, contextoComoTexto, type ContextoNegocio } from './contexto'

export type TipoInsight = 'ventas' | 'gastos' | 'proyeccion' | 'general' | 'inventario' | 'rrhh' | 'tesoreria'

const FALLBACK_VACIO = 'No pude generar el análisis ahora mismo. Vuelve a intentarlo en un momento.'

function systemPrompt(ctx: ContextoNegocio): string {
  const usuario = ctx.nombreUsuario
    ? `Te diriges a ${ctx.nombreUsuario} (el dueño): puedes llamarle por su nombre de vez en cuando, con naturalidad, sin abusar.`
    : 'Te diriges al dueño del negocio, de tú.'
  return [
    `Eres ${ctx.nombreAgente}, asesor de IA de "${ctx.nombreEmpresa}".`,
    `Hablas en español de tú, con tono ${ctx.tono}. ${usuario}`,
    'Suena humano y cercano, no robótico: NO repitas el nombre del negocio una y otra vez (ya saben cuál es), ve al grano.',
    'IMPORTANTE de formato: responde en prosa breve y natural, en frases. NADA de tablas, ni markdown, ni viñetas, ni asteriscos, ni almohadillas, ni listas con guiones. Como si lo dijeras en voz alta.',
    'Respondes SOLO con la información del contexto JSON que se te entrega (datos reales y ya agregados de ESTE negocio). Si falta un dato, dilo con honestidad y sugiere qué módulo lo aportaría; nunca inventes cifras.',
    'No mezcles importes de monedas distintas en una sola cifra; trata cada moneda por separado y, si existe, usa el consolidado.',
    'Da conclusiones accionables y concretas (qué pasa y qué conviene hacer), no listados de números crudos.',
  ].join(' ')
}

const PROMPTS_INSIGHT: Record<TipoInsight, string> = {
  ventas:     'Analiza la evolución de mis VENTAS de los últimos 6 meses: tendencia, mejor y peor mes, y una recomendación. Máximo 5 frases.',
  gastos:     'Analiza mis GASTOS de los últimos 6 meses: tendencia, posibles anomalías y dónde podría ahorrar. Máximo 5 frases.',
  proyeccion: 'Proyecta mis ingresos y resultado del próximo mes según la tendencia reciente, indicando el supuesto usado. Sé prudente. Máximo 5 frases.',
  general:    'Dame un análisis general de la salud de mi negocio con lo más relevante de ventas, gastos, caja y agenda, y 1-2 acciones prioritarias. Máximo 6 frases.',
  inventario: 'Analiza mi INVENTARIO: productos bajo mínimo, riesgo de quedarme sin stock y qué conviene reponer primero. Máximo 5 frases.',
  rrhh:       'Analiza mi PERSONAL: tamaño de la plantilla, altas recientes y lo más relevante del coste de personal. Máximo 5 frases.',
  tesoreria:  'Analiza mi LIQUIDEZ: saldos de caja por moneda y cómo se ven frente a mis ventas y gastos recientes. Máximo 5 frases.',
}

const FOCO: Record<TipoInsight, 'ventas' | 'gastos' | 'general'> = {
  ventas: 'ventas', gastos: 'gastos', proyeccion: 'ventas', general: 'general',
  inventario: 'general', rrhh: 'general', tesoreria: 'general',
}

// Insight puntual disparado desde un touchpoint. Cuenta como conversación nueva.
export async function generarInsight(clientId: string, tipo: TipoInsight, nombreUsuario?: string | null): Promise<string> {
  const ctx = await construirContexto(clientId, nombreUsuario)
  const contexto = contextoComoTexto(ctx, FOCO[tipo])
  const mensajes: IaMensaje[] = [
    { role: 'system', content: systemPrompt(ctx) },
    { role: 'user', content: `Contexto del negocio (JSON):\n${contexto}\n\nTarea: ${PROMPTS_INSIGHT[tipo]}` },
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
