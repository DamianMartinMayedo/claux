// ── Capa de IA del bot (add-on, motor híbrido CONTEXTO §6) ──
// La IA SOLO interpreta lenguaje libre: extrae la intención y los datos de un
// mensaje y los devuelve estructurados. La ACCIÓN (crear la reserva/cita,
// validar aforo) la sigue ejecutando el código determinista con las RPCs ya
// existentes. Si no hay addon o el proveedor falla, devuelve null y el bot cae
// al flujo de botones de siempre (degradación elegante, coste cero).

import { chat, IaNoConfigurada } from './provider'
import { registrarUso } from './uso'
import { hoyEnTz } from '@/lib/fecha-tz'

export interface IntentBot {
  intent: 'reservar' | 'horarios' | 'otro'
  fecha: string | null     // YYYY-MM-DD
  personas: number | null
}

function validarFecha(v: unknown, hoy: string): string | null {
  if (typeof v !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  return v >= hoy ? v : null
}

// Interpreta un mensaje libre. `etiquetaReserva` adapta el vocabulario al sector
// ("reserva" | "cita"). Cuenta como una interacción de IA (medición por tenant).
export async function interpretarMensajeBot(
  clientId: string,
  etiquetaReserva: string,
  texto: string,
): Promise<IntentBot | null> {
  const hoy = hoyEnTz()
  const sys = [
    `Eres un extractor de intención para el bot de un negocio. Hoy es ${hoy} (zona America/Havana).`,
    `Devuelves SOLO un objeto JSON con las claves: intent, fecha, personas.`,
    `intent: "reservar" si el usuario quiere pedir una ${etiquetaReserva}; "horarios" si pregunta por horarios/cuándo abren; "otro" en cualquier otro caso.`,
    `fecha: la fecha en formato YYYY-MM-DD resolviendo expresiones relativas (hoy, mañana, "el viernes", "el 25") respecto a hoy; null si no se menciona.`,
    `personas: número entero de personas si se menciona; null si no.`,
    `No añadas texto fuera del JSON.`,
  ].join(' ')

  try {
    const { texto: out, usage } = await chat({
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: texto }],
      json: true, temperature: 0, maxTokens: 800, clientId,
    })
    await registrarUso(clientId, usage, true)

    const o = JSON.parse(out) as Record<string, unknown>
    // Tolerante: el modelo puede devolver "reserva"/"reservar"/"cita". Cualquier
    // variante de reserva/cita cuenta como intención de reservar.
    const raw = typeof o.intent === 'string' ? o.intent.toLowerCase() : ''
    const intent: IntentBot['intent'] =
      /reserv|cita/.test(raw) ? 'reservar' : raw === 'horarios' ? 'horarios' : 'otro'
    const personas = Number.isFinite(Number(o.personas)) && Number(o.personas) > 0
      ? Math.min(Math.floor(Number(o.personas)), 20) : null
    return { intent, fecha: validarFecha(o.fecha, hoy), personas }
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] interpretarMensajeBot', e)
    return null
  }
}

// ── Asistente conversacional del bot (modo IA activo) ──────────────────────────
// A diferencia de interpretarMensajeBot (solo NLU → botones), aquí la IA MANTIENE
// la conversación en lenguaje natural: pregunta lo que falte, propone horas reales
// (se le inyectan como contexto — nunca las inventa) y devuelve, además del texto
// para el cliente, los datos estructurados que el CÓDIGO valida y ejecuta. La IA
// NUNCA crea la reserva: cuando están los 4 datos, el bot muestra resumen + botón.

export interface TurnoConv { rol: 'user' | 'assistant'; texto: string }

export interface RespuestaConversacion {
  respuesta: string          // único texto que ve el cliente (natural, sin markdown)
  fecha:     string | null   // YYYY-MM-DD
  hora:      string | null   // HH:MM
  personas:  number | null
  nombre:    string | null
}

export interface ParamsConversacion {
  clientId:           string
  etiqueta:           string   // 'reserva' | 'cita' (vocabulario del sector)
  negocio:            string
  horariosTexto:      string           // horarios generales del negocio
  disponibilidadTexto: string | null   // horas libres reales para la fecha en curso
  cartaUrl:           string | null    // enlace del menú digital, si el negocio lo tiene
  pideNombre:         boolean           // false hasta tener fecha/hora/personas (evita pedir todo de golpe)
  datos:              { fecha?: string; hora?: string; personas?: number; nombre?: string }
  historial:          TurnoConv[]
  mensaje:            string
}

function limpiarJson(s: string): string {
  const t = s.trim()
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (m) return m[1].trim()
  const i = t.indexOf('{'); const j = t.lastIndexOf('}')
  return i >= 0 && j > i ? t.slice(i, j + 1) : t
}

export async function conversarReserva(p: ParamsConversacion): Promise<RespuestaConversacion | null> {
  const hoy = hoyEnTz()
  const sys = [
    `Eres el asistente de ${p.negocio} en Telegram. Hoy es ${hoy} (zona America/Havana).`,
    `Atiendes a clientes que quieren hacer una ${p.etiqueta}. Habla español de forma cálida, cercana y educada, tratando de tú: frases cortas y naturales, SIN emojis, sin markdown ni listas.`,
    `Si te preguntan algo que no tiene que ver con la ${p.etiqueta} ni con la carta, responde con cordialidad y en pocas palabras, y reconduce con naturalidad hacia la ${p.etiqueta} (nunca sueltes respuestas robóticas ni repitas siempre lo mismo).`,
    `Horario del negocio: ${p.horariosTexto || 'no especificado'}.`,
    p.disponibilidadTexto
      ? `Horas libres REALES para la fecha en curso: ${p.disponibilidadTexto}. Propón SOLO estas horas; si piden otra, dilo con amabilidad y ofréceles de estas.`
      : `Aún no hay una fecha concreta. Si preguntan por los horarios o por qué horas hay, diles el horario general del negocio y pregúntales para qué día quieren, para mirarles las horas libres exactas.`,
    p.cartaUrl ? `Si preguntan por la carta o el menú, comparte este enlace tal cual: ${p.cartaUrl}` : ``,
    `Datos ya recogidos: ${JSON.stringify(p.datos)}.`,
    `Objetivo: reunir fecha, hora, número de personas y nombre. Pregunta SOLO lo que falte, de una en una, con naturalidad.`,
    p.pideNombre ? `` : `Todavía NO pidas el nombre: primero cierra fecha, hora y personas.`,
    `No inventes disponibilidad. No confirmes tú la ${p.etiqueta}: cuando tengas los 4 datos, en 'respuesta' di algo como "te muestro el resumen para confirmar" (el sistema pondrá el botón).`,
    `Responde SIEMPRE con un único objeto JSON válido y COMPLETO, sin nada de texto fuera de él, con estas claves exactas: respuesta (string, lo único que verá el cliente), fecha (YYYY-MM-DD o null), hora (HH:MM o null), personas (entero o null), nombre (string o null). Incluye también los datos ya recogidos.`,
  ].filter(Boolean).join(' ')

  const mensajes = [
    { role: 'system' as const, content: sys },
    ...p.historial.slice(-6).map(t => ({ role: t.rol, content: t.texto })),
    { role: 'user' as const, content: p.mensaje },
  ]

  try {
    // Margen alto: es un modelo de razonamiento y gasta tokens "pensando" antes
    // de emitir el JSON; con poco margen el contenido sale vacío/truncado y el
    // parseo falla ("Unexpected end of JSON input").
    const { texto, usage } = await chat({ mensajes, json: true, temperature: 0.4, maxTokens: 3000, clientId: p.clientId })
    await registrarUso(p.clientId, usage, p.historial.length === 0)

    const o = JSON.parse(limpiarJson(texto)) as Record<string, unknown>
    const respuesta = typeof o.respuesta === 'string' ? o.respuesta.trim() : ''
    if (!respuesta) return null

    const fecha = validarFecha(o.fecha, hoy)
    const horaRaw = typeof o.hora === 'string' ? o.hora.trim() : ''
    const hora = /^\d{1,2}:\d{2}$/.test(horaRaw) ? horaRaw.padStart(5, '0') : null
    const personas = Number.isFinite(Number(o.personas)) && Number(o.personas) > 0
      ? Math.min(Math.floor(Number(o.personas)), 20) : null
    const nombre = typeof o.nombre === 'string' && o.nombre.trim().length >= 2 ? o.nombre.trim() : null

    return { respuesta, fecha, hora, personas, nombre }
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] conversarReserva', e)
    return null
  }
}
