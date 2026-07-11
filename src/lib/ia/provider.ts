// ── Adaptador de proveedor de IA (server-only) ──
// CONTEXTO §4: toda llamada a IA sale del SERVIDOR, nunca del cliente, y el
// proveedor es un adaptador intercambiable. Hablamos el dialecto OpenAI-compatible
// (OpenCode Zen, DeepSeek directo, etc.). Proveedor/modelo/base se leen de `settings`
// en runtime (cambiables desde el admin sin redeploy); la API key vive en env/secret.
//
// MVP: modelo gratis `opencode/deepseek-v4-flash-free`. Pasar a pago = cambiar
// `settings.ia_model` (cero código).

import { resolverModelo, resolverFallbackGratis, type ModeloResuelto } from './modelo'

export interface IaMensaje { role: 'system' | 'user' | 'assistant'; content: string }
export interface IaUsage  { tokensIn: number; tokensOut: number }
export interface IaResultado { texto: string; usage: IaUsage }

export class IaNoConfigurada extends Error {
  constructor() { super('El asistente IA no está configurado (falta la API key del proveedor).') }
}

interface ChatOpts {
  mensajes: IaMensaje[]
  /** Cliente para resolver su modelo (aplica auto-fallback a gratis por cupo). */
  clientId?: string
  /** Pide salida JSON estricta (response_format json_object). */
  json?: boolean
  temperature?: number
  maxTokens?: number
}

type Intento = { ok: true; res: IaResultado } | { ok: false; error: string }

// Un intento contra UN modelo concreto (con su base/key). Reintenta una vez ante
// 5xx o error de red; los 4xx se cortan al instante. Una respuesta vacía cuenta
// como fallo (los modelos de razonamiento a veces devuelven `content` vacío).
async function intentarModelo(cfg: ModeloResuelto & { apiKey: string }, opts: ChatOpts): Promise<Intento> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: opts.mensajes,
    temperature: opts.temperature ?? 0.3,
    // Holgado por defecto: los modelos de razonamiento consumen tokens antes de
    // emitir la respuesta visible; con poco margen `content` sale vacío.
    max_tokens: opts.maxTokens ?? 1400,
  }
  if (opts.json) body.response_format = { type: 'json_object' }

  const url = `${cfg.base}/chat/completions`
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }
  let ultimoError = ''

  for (let intento = 0; intento < 2; intento++) {
    let res: Response
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    } catch (e) {
      ultimoError = `red: ${(e as Error).message}`
      continue // reintenta una vez ante fallo de red
    }

    if (res.ok) {
      const data = await res.json()
      const texto: string = (data?.choices?.[0]?.message?.content ?? '').trim()
      if (!texto) { ultimoError = 'respuesta vacía'; break } // otro modelo lo hará mejor
      return {
        ok: true,
        res: {
          texto,
          usage: {
            tokensIn:  Number(data?.usage?.prompt_tokens) || 0,
            tokensOut: Number(data?.usage?.completion_tokens) || 0,
          },
        },
      }
    }

    const detalle = await res.text().catch(() => '')
    ultimoError = `HTTP ${res.status}: ${detalle.slice(0, 300)}`
    if (res.status < 500) break // 4xx no se reintenta
  }

  return { ok: false, error: ultimoError }
}

// Una sola llamada de chat. Resuelve el modelo del cliente (ia_modelos + cupo) en
// runtime. Lanza IaNoConfigurada si no hay key; el llamador la traduce a un mensaje
// amable. Red de seguridad: si el modelo elegido falla en el proveedor (lo rechaza,
// 5xx persistente o respuesta vacía), reintenta con el modelo gratis de respaldo
// antes de propagar el error — así un modelo mal elegido no tumba todo el asistente.
export async function chat(opts: ChatOpts): Promise<IaResultado> {
  const cfg = await resolverModelo(opts.clientId)
  if (!cfg.apiKey) throw new IaNoConfigurada()

  const primero = await intentarModelo({ ...cfg, apiKey: cfg.apiKey }, opts)
  if (primero.ok) return primero.res

  const fb = await resolverFallbackGratis()
  if (fb.apiKey && fb.model !== cfg.model) {
    const segundo = await intentarModelo({ ...fb, apiKey: fb.apiKey }, opts)
    if (segundo.ok) return segundo.res
    throw new Error(`IA falló: ${cfg.model} (${primero.error}); respaldo ${fb.model} (${segundo.error})`)
  }

  throw new Error(`IA ${cfg.model}: ${primero.error}`)
}
