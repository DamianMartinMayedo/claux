// ── Adaptador de proveedor de IA (server-only) ──
// CONTEXTO §4: toda llamada a IA sale del SERVIDOR, nunca del cliente, y el
// proveedor es un adaptador intercambiable. Hablamos el dialecto OpenAI-compatible
// (OpenCode Zen, DeepSeek directo, etc.). Proveedor/modelo/base se leen de `settings`
// en runtime (cambiables desde el admin sin redeploy); la API key vive en env/secret.
//
// MVP: modelo gratis `opencode/deepseek-v4-flash-free`. Pasar a pago = cambiar
// `settings.ia_model` (cero código).

import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_BASE  = 'https://opencode.ai/zen/v1'
// OJO: los ids de OpenCode Zen van SIN prefijo `opencode/`. deepseek-v4-flash-free
// es un modelo de razonamiento (gasta tokens "pensando" antes de responder), por
// eso los max_tokens de las llamadas son holgados.
const DEFAULT_MODEL = 'deepseek-v4-flash-free'

export interface IaMensaje { role: 'system' | 'user' | 'assistant'; content: string }
export interface IaUsage  { tokensIn: number; tokensOut: number }
export interface IaResultado { texto: string; usage: IaUsage }

export interface IaConfig { base: string; model: string; apiKey: string | null }

// Lee la config efectiva del proveedor desde `settings` (con defaults) + env.
export async function leerConfigIa(): Promise<IaConfig> {
  const db = createAdminClient()
  const { data } = await db
    .from('settings')
    .select('key, value')
    .in('key', ['ia_api_base', 'ia_model'])
  const map = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  return {
    base:   (map.ia_api_base || DEFAULT_BASE).replace(/\/$/, ''),
    model:  map.ia_model || DEFAULT_MODEL,
    apiKey: process.env.OPENCODE_ZEN_API_KEY || process.env.IA_API_KEY || null,
  }
}

export class IaNoConfigurada extends Error {
  constructor() { super('El asistente IA no está configurado (falta la API key del proveedor).') }
}

interface ChatOpts {
  mensajes: IaMensaje[]
  /** Pide salida JSON estricta (response_format json_object). */
  json?: boolean
  temperature?: number
  maxTokens?: number
}

// Una sola llamada de chat. Lanza IaNoConfigurada si no hay key; el llamador la
// traduce a un mensaje amable. Cualquier error de red/HTTP se propaga como Error.
export async function chat(opts: ChatOpts): Promise<IaResultado> {
  const cfg = await leerConfigIa()
  if (!cfg.apiKey) throw new IaNoConfigurada()

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: opts.mensajes,
    temperature: opts.temperature ?? 0.3,
    // Holgado por defecto: los modelos de razonamiento consumen tokens antes de
    // emitir la respuesta visible; con poco margen `content` sale vacío.
    max_tokens: opts.maxTokens ?? 1400,
  }
  if (opts.json) body.response_format = { type: 'json_object' }

  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detalle = await res.text().catch(() => '')
    throw new Error(`IA HTTP ${res.status}: ${detalle.slice(0, 300)}`)
  }

  const data = await res.json()
  const texto: string = data?.choices?.[0]?.message?.content ?? ''
  const usage: IaUsage = {
    tokensIn:  Number(data?.usage?.prompt_tokens) || 0,
    tokensOut: Number(data?.usage?.completion_tokens) || 0,
  }
  return { texto: texto.trim(), usage }
}
