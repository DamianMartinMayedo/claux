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
      json: true, temperature: 0, maxTokens: 800,
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
