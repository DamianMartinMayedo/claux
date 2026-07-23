// ── Resolución del modelo a usar por cliente (server-only) ──
// El admin gestiona qué modelos están activos (tabla ia_modelos), cuál es el
// principal (settings.ia_model) y el de respaldo gratis (ia_modelo_fallback_gratis).
// Regla de control de coste (decisión del propietario): si un cliente supera su
// cupo del mes, sus consultas pasan automáticamente al modelo gratis de respaldo.
// El cupo es global (settings.ia_cupo_conversaciones) con override por cliente
// (clients.ia_config.cupo).

import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_BASE     = 'https://opencode.ai/zen/v1'
const DEFAULT_MODEL    = 'deepseek-v4-flash-free'
const DEFAULT_CUPO     = 500

export interface ModeloResuelto {
  model: string
  base: string
  apiKey: string | null
  esFallback: boolean   // true = se bajó a gratis por superar el cupo
}

interface ModeloRow { id: string; activo: boolean; gratis: boolean; api_base: string | null; api_key_env: string | null }

function periodoActual(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit' })
    .format(new Date()).slice(0, 7)
}

function keyDe(envName: string | null | undefined): string | null {
  const name = envName || 'OPENCODE_ZEN_API_KEY'
  return process.env[name] || process.env.OPENCODE_ZEN_API_KEY || process.env.IA_API_KEY || null
}

// Cupo efectivo del cliente: override en ia_config.cupo, si no el global.
export async function cupoEfectivo(clientId: string): Promise<number> {
  const db = createAdminClient()
  const [{ data: cli }, { data: setRow }] = await Promise.all([
    db.from('clients').select('ia_config').eq('client_id', clientId).maybeSingle(),
    db.from('settings').select('value').eq('key', 'ia_cupo_conversaciones').maybeSingle(),
  ])
  const cfg = (cli?.ia_config && typeof cli.ia_config === 'object') ? cli.ia_config as Record<string, unknown> : {}
  const override = Number(cfg.cupo)
  if (Number.isFinite(override) && override > 0) return Math.floor(override)
  const global = parseInt(String(setRow?.value ?? ''), 10)
  return Number.isFinite(global) && global > 0 ? global : DEFAULT_CUPO
}

// Resuelve el modelo + endpoint + key. Si se pasa clientId, aplica el auto-fallback
// a gratis cuando ese cliente ya superó su cupo del mes.
export async function resolverModelo(clientId?: string): Promise<ModeloResuelto> {
  const db = createAdminClient()
  const { data: setRows } = await db.from('settings').select('key, value')
    .in('key', ['ia_model', 'ia_modelo_fallback_gratis', 'ia_api_base', 'ia_cupo_conversaciones'])
  const S = Object.fromEntries((setRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))

  const principal = S.ia_model || DEFAULT_MODEL
  const fallback  = S.ia_modelo_fallback_gratis || DEFAULT_MODEL
  const baseGlobal = (S.ia_api_base || DEFAULT_BASE).replace(/\/$/, '')

  let elegido = principal
  let esFallback = false

  // Auto-fallback por cupo (solo con cliente y solo si el principal no es ya gratis).
  if (clientId) {
    const [{ data: catP }, cupo, usados] = await Promise.all([
      db.from('ia_modelos').select('id, gratis').eq('id', principal).maybeSingle(),
      cupoEfectivo(clientId),
      conversacionesMes(db, clientId),
    ])
    const principalEsGratis = catP?.gratis ?? false
    if (!principalEsGratis && usados >= cupo) {
      elegido = fallback
      esFallback = true
    }
  }

  // Buscar el modelo elegido en el catálogo. Si está inactivo o no existe, caer al
  // fallback gratis; si tampoco, al DEFAULT_MODEL.
  let row = await leerModelo(db, elegido)
  if (!row || !row.activo) {
    elegido = fallback; esFallback = true
    row = await leerModelo(db, elegido)
  }

  const base = (row?.api_base || baseGlobal).replace(/\/$/, '')
  const apiKey = keyDe(row?.api_key_env)
  return { model: row?.id || DEFAULT_MODEL, base, apiKey, esFallback }
}

// Config del modelo gratis de respaldo (settings.ia_modelo_fallback_gratis).
// La usa provider.chat() como red de seguridad: si el modelo elegido falla en el
// proveedor (lo rechaza, 5xx persistente o respuesta vacía), reintenta con este
// en vez de tumbar todo el asistente. Si el respaldo configurado no sirve, cae al
// DEFAULT_MODEL con la base global.
export async function resolverFallbackGratis(): Promise<ModeloResuelto> {
  const db = createAdminClient()
  const { data: setRows } = await db.from('settings').select('key, value')
    .in('key', ['ia_modelo_fallback_gratis', 'ia_api_base'])
  const S = Object.fromEntries((setRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  const baseGlobal = (S.ia_api_base || DEFAULT_BASE).replace(/\/$/, '')
  const id = S.ia_modelo_fallback_gratis || DEFAULT_MODEL

  const row = await leerModelo(db, id)
  if (!row || !row.activo) {
    return { model: DEFAULT_MODEL, base: baseGlobal, apiKey: keyDe(null), esFallback: true }
  }
  const base = (row.api_base || baseGlobal).replace(/\/$/, '')
  return { model: row.id, base, apiKey: keyDe(row.api_key_env), esFallback: true }
}

// Prueba de vida de UN modelo concreto (health-check del admin). Hace la llamada
// mínima real contra el proveedor con la base+key de ese modelo. Sirve para
// detectar a tiempo que el proveedor dejó de servir un id ANTES de que un cliente
// se quede sin IA. Sin auto-fallback: aquí queremos saber la verdad de ESTE id.
export interface PruebaModelo {
  ok:        boolean   // HTTP 200 → el proveedor sirve el id
  status:    number    // código HTTP (0 = error de red)
  ms:        number    // latencia
  respondio: boolean   // llegó `content` no vacío (los de razonamiento a veces no)
  error?:    string
}

export async function probarModelo(id: string): Promise<PruebaModelo> {
  const db = createAdminClient()
  const [{ data: setRow }, row] = await Promise.all([
    db.from('settings').select('value').eq('key', 'ia_api_base').maybeSingle(),
    leerModelo(db, id),
  ])
  const base   = ((row?.api_base || setRow?.value || DEFAULT_BASE) as string).replace(/\/$/, '')
  const apiKey = keyDe(row?.api_key_env)
  if (!apiKey) return { ok: false, status: 0, ms: 0, respondio: false, error: 'Falta la API key del proveedor.' }

  // max_tokens holgado: un modelo de razonamiento con poco margen devuelve 200 con
  // `content` vacío, y eso NO significa que esté caído.
  const body = {
    model: id,
    messages: [{ role: 'user', content: 'Responde solo con: ok' }],
    temperature: 0,
    max_tokens: 256,
  }
  const t0 = Date.now()
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })
    const ms = Date.now() - t0
    if (!res.ok) {
      const detalle = await res.text().catch(() => '')
      return { ok: false, status: res.status, ms, respondio: false, error: `HTTP ${res.status}: ${detalle.slice(0, 160)}` }
    }
    const data = await res.json().catch(() => null)
    const texto = (data?.choices?.[0]?.message?.content ?? '').trim()
    return { ok: true, status: 200, ms, respondio: !!texto }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, respondio: false, error: `red: ${(e as Error).message}` }
  }
}

async function leerModelo(db: ReturnType<typeof createAdminClient>, id: string): Promise<ModeloRow | null> {
  const { data } = await db.from('ia_modelos').select('id, activo, gratis, api_base, api_key_env').eq('id', id).maybeSingle()
  return (data as ModeloRow | null) ?? null
}

async function conversacionesMes(db: ReturnType<typeof createAdminClient>, clientId: string): Promise<number> {
  const { data } = await db.from('ia_uso').select('conversaciones')
    .eq('client_id', clientId).eq('periodo', periodoActual()).maybeSingle()
  return Number(data?.conversaciones) || 0
}
