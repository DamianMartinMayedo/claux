// ── Resolución del modelo a usar (server-only) ──
// El admin gestiona qué modelos están activos (tabla ia_modelos), cuál es el
// principal (settings.ia_model) y el de respaldo gratis (ia_modelo_fallback_gratis).
// Regla de control de coste (decisión del propietario): si un cliente supera su
// cupo del mes, sus consultas pasan automáticamente al modelo gratis de respaldo.
// El cupo lo fija el NIVEL contratado (nivel_limites.ia_conversaciones: 500 /
// 1.500 / 5.000), con override por cliente en clients.ia_config.cupo y el
// settings.ia_cupo_conversaciones como red de seguridad si el nivel no tuviera
// fila. Antes solo existían los dos últimos: el número del nivel se editaba en
// /admin/niveles y no lo leía nadie.
//
// DOS POLÍTICAS, UNA PUERTA (migs. 234-235). Quién paga la llamada lo decide QUIÉN
// CONDUCE la sesión, no qué hace:
//
//   · `{ tipo: 'cliente' }` — la conduce el dueño del negocio desde su portal. La
//     paga su addon `asistente_ia`, se mide en `ia_uso` y el tope es BLANDO: al
//     agotar el cupo no se le corta la conversación, se le baja al modelo gratis.
//   · `{ tipo: 'interno' }` — la conduce nuestro equipo desde /admin. La paga CLAUX,
//     se mide en `ia_uso_interno` por origen y el tope es DURO: es nuestro dinero,
//     así que al agotarse se corta y avisa (ver `lib/ia/interna.ts`).
//
// Y el MODELO ya no es uno global: cada nivel tiene el suyo (`niveles.ia_model`,
// mig. 234), que es lo que hace que el escalón se note en la calidad de la
// respuesta y no solo en cuántas preguntas caben.

import { createAdminClient } from '@/lib/supabase/admin'
import { PRUEBA_LENTA_MS } from './prueba-tipos'
import { mesEnTz } from '@/lib/fecha-tz'

const DEFAULT_BASE     = 'https://opencode.ai/zen/v1'
const DEFAULT_CUPO     = 500

// Aquí NO hay un `DEFAULT_MODEL`. Lo hubo —`deepseek-v4-flash-free`— y el día que
// ese modelo se borró de `ia_modelos` la constante se quedó, apuntando a un id que
// ya no existía: si el principal y el respaldo hubieran faltado, se le mandaba al
// proveedor un modelo inexistente y el error llegaba desde fuera, sin pistas.
// Ningún id de modelo se teclea en el código: el último recurso sale del catálogo
// (`ultimoRecurso`), y si no hay ninguno activo, `model` es null y quien llama dice
// que la IA no está configurada.

/** En qué se gasta la bolsa interna. Mismo juego que el CHECK de `ia_uso_interno`. */
export type OrigenIa = 'importador' | 'propuesta' | 'soporte' | 'relleno'

/**
 * Quién conduce la sesión. Es la única llave que necesita el resolutor: de ella
 * salen el modelo, el cupo y contra qué tabla se mide. Sin contexto (`undefined`)
 * es una llamada suelta —una prueba del admin— que usa el principal global.
 */
export type CtxIa =
  | { tipo: 'cliente'; clientId: string }
  | { tipo: 'interno'; origen: OrigenIa }

export interface ModeloResuelto {
  /** null = no hay ningún modelo activo en el catálogo. */
  model: string | null
  base: string
  apiKey: string | null
  esFallback: boolean   // true = se bajó a gratis por superar el cupo
}

interface ModeloRow { id: string; activo: boolean; gratis: boolean; api_base: string | null; api_key_env: string | null; key_hint: string | null }

// Resuelve la API key de un modelo, por orden de prioridad:
//   1. Clave guardada en el sistema (Supabase Vault, vía RPC ia_key_get) — la que se
//      configura desde el admin. No depende de variables de entorno de Vercel.
//   2. Variable de entorno nombrada en api_key_env (para quien prefiera el env).
//   3. Clave por defecto de OpenCode Zen — SOLO para la base de Zen. Antes se usaba
//      para cualquier modelo sin key: eso mandaba la key de Zen a un proveedor ajeno
//      (p. ej. Gemini) y devolvía un 401 despistante. Ahora, base ajena sin key = null.
async function resolverApiKey(
  db: ReturnType<typeof createAdminClient>,
  row: ModeloRow | null,
  base: string,
): Promise<string | null> {
  if (row?.key_hint) {
    const { data, error } = await db.rpc('ia_key_get', { p_id: row.id })
    if (!error && typeof data === 'string' && data.trim()) return data
  }
  const envName = row?.api_key_env
  if (envName && process.env[envName]) return process.env[envName] as string
  if (base.startsWith('https://opencode.ai')) {
    return process.env.OPENCODE_ZEN_API_KEY || process.env.IA_API_KEY || null
  }
  return null
}

/**
 * Cupo efectivo del cliente, por orden: `ia_config.cupo` (excepción negociada) →
 * el del nivel contratado → el global de settings → 500.
 *
 * `Infinity` si el nivel lo tiene en ilimitado (`base` NULL): quien no tiene tope
 * nunca cae al modelo gratis. Los tres niveles de hoy traen número, así que es un
 * caso que solo aparece si alguien lo pone a mano en /admin/niveles.
 */
export async function cupoEfectivo(clientId: string): Promise<number> {
  const db = createAdminClient()
  // `ia_config` y `nivel` salen de la MISMA fila: se piden juntos. Estaban en dos
  // consultas seguidas a `clients` —la segunda solo para el nivel— y esto se llama
  // en cada mensaje del asistente.
  const [{ data: cli }, { data: setRow }] = await Promise.all([
    db.from('clients').select('ia_config, nivel').eq('client_id', clientId).maybeSingle(),
    db.from('settings').select('value').eq('key', 'ia_cupo_conversaciones').maybeSingle(),
  ])
  const cfg = (cli?.ia_config && typeof cli.ia_config === 'object') ? cli.ia_config as Record<string, unknown> : {}
  const override = Number(cfg.cupo)
  if (Number.isFinite(override) && override > 0) return Math.floor(override)

  // El nivel. Se lee aquí y no en `cargarContextoLimites` para no arrastrar a
  // `lib/limites` una dimensión que no se cuenta por filas activas.
  const nivel = typeof cli?.nivel === 'string' ? cli.nivel : 'inicial'
  const { data: fila } = await db.from('nivel_limites')
    .select('base').eq('nivel', nivel).eq('dimension', 'ia_conversaciones').maybeSingle()
  if (fila) return fila.base === null ? Infinity : Math.floor(Number(fila.base))

  const global = parseInt(String(setRow?.value ?? ''), 10)
  return Number.isFinite(global) && global > 0 ? global : DEFAULT_CUPO
}

/**
 * El modelo que le toca a un cliente: su excepción negociada (`ia_config.modelo`)
 * → el de su nivel (`niveles.ia_model`) → null, que quien llama traduce al
 * principal global.
 *
 * Solo devuelve ids que existan y estén ACTIVOS en el catálogo. Si no se filtrara
 * aquí, un modelo apagado en /admin/ia mandaría a ese cliente directo al respaldo
 * gratis (el camino de más abajo), cuando lo correcto es que baje un escalón: al
 * principal global. El precio de la comprobación es una consulta con `in`.
 */
async function modeloDelCliente(db: ReturnType<typeof createAdminClient>, clientId: string): Promise<string | null> {
  const { data: cli } = await db.from('clients').select('ia_config, nivel').eq('client_id', clientId).maybeSingle()
  const cfg = (cli?.ia_config && typeof cli.ia_config === 'object') ? cli.ia_config as Record<string, unknown> : {}
  const excepcion = typeof cfg.modelo === 'string' ? cfg.modelo.trim() : ''

  let delNivel = ''
  const clave = typeof cli?.nivel === 'string' ? cli.nivel.trim() : ''
  if (clave) {
    const { data: fila } = await db.from('niveles').select('ia_model').eq('clave', clave).maybeSingle()
    delNivel = typeof fila?.ia_model === 'string' ? fila.ia_model.trim() : ''
  }

  const candidatos = [excepcion, delNivel].filter(Boolean)
  if (!candidatos.length) return null
  const { data: vivos } = await db.from('ia_modelos').select('id').in('id', candidatos).eq('activo', true)
  const activos = new Set((vivos ?? []).map((r: { id: string }) => r.id))
  return candidatos.find(id => activos.has(id)) ?? null
}

/**
 * Resuelve modelo + endpoint + key para quien conduce la sesión (ver la cabecera).
 *
 * Con `{ tipo: 'cliente' }` aplica el auto-fallback a gratis si ese cliente ya
 * superó su cupo del mes; con `{ tipo: 'interno' }` no hay auto-fallback ninguno,
 * porque la bolsa interna se corta antes de llegar aquí (`lib/ia/interna.ts`).
 */
export async function resolverModelo(ctx?: CtxIa): Promise<ModeloResuelto> {
  const db = createAdminClient()
  const { data: setRows } = await db.from('settings').select('key, value')
    .in('key', ['ia_model', 'ia_model_interno', 'ia_modelo_fallback_gratis', 'ia_api_base', 'ia_cupo_conversaciones'])
  const S = Object.fromEntries((setRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))

  const global    = S.ia_model || ''
  const fallback  = S.ia_modelo_fallback_gratis || ''
  const baseGlobal = (S.ia_api_base || DEFAULT_BASE).replace(/\/$/, '')

  // De quién conduce sale el principal. `ia_model_interno` vacío —que es como
  // nace— significa «el mismo que el de los clientes», no «ninguno».
  let principal = global
  if (ctx?.tipo === 'interno') principal = (S.ia_model_interno || '').trim() || global
  else if (ctx?.tipo === 'cliente') principal = (await modeloDelCliente(db, ctx.clientId)) || global

  let elegido = principal
  let esFallback = false

  // Auto-fallback por cupo (solo con cliente y solo si el principal no es ya gratis).
  if (ctx?.tipo === 'cliente' && principal) {
    const [{ data: catP }, cupo, usados] = await Promise.all([
      db.from('ia_modelos').select('id, gratis').eq('id', principal).maybeSingle(),
      cupoEfectivo(ctx.clientId),
      conversacionesMes(db, ctx.clientId),
    ])
    const principalEsGratis = catP?.gratis ?? false
    if (!principalEsGratis && usados >= cupo) {
      elegido = fallback
      esFallback = true
    }
  }

  // Buscar el modelo elegido en el catálogo. Si está inactivo o no existe, caer al
  // respaldo gratis; y si tampoco sirve, al último recurso QUE EXISTA en la tabla.
  let row = elegido ? await leerModelo(db, elegido) : null
  if ((!row || !row.activo) && fallback && fallback !== elegido) {
    elegido = fallback; esFallback = true
    row = await leerModelo(db, elegido)
  }
  if (!row || !row.activo) {
    row = await ultimoRecurso(db)
    esFallback = true
  }

  const base = (row?.api_base || baseGlobal).replace(/\/$/, '')
  const apiKey = await resolverApiKey(db, row, base)
  return { model: row?.id ?? null, base, apiKey, esFallback }
}

// Config del modelo gratis de respaldo (settings.ia_modelo_fallback_gratis).
// La usa provider.chat() como red de seguridad: si el modelo elegido falla en el
// proveedor (lo rechaza, 5xx persistente o respuesta vacía), reintenta con este
// en vez de tumbar todo el asistente. Si el respaldo configurado no sirve, cae al
// último recurso del catálogo — nunca a un id escrito en el código.
export async function resolverFallbackGratis(): Promise<ModeloResuelto> {
  const db = createAdminClient()
  const { data: setRows } = await db.from('settings').select('key, value')
    .in('key', ['ia_modelo_fallback_gratis', 'ia_api_base'])
  const S = Object.fromEntries((setRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  const baseGlobal = (S.ia_api_base || DEFAULT_BASE).replace(/\/$/, '')
  const id = S.ia_modelo_fallback_gratis || ''

  const row = id ? await leerModelo(db, id) : null
  if (!row || !row.activo) {
    const ultimo = await ultimoRecurso(db)
    const base = (ultimo?.api_base || baseGlobal).replace(/\/$/, '')
    return { model: ultimo?.id ?? null, base, apiKey: await resolverApiKey(db, ultimo, base), esFallback: true }
  }
  const base = (row.api_base || baseGlobal).replace(/\/$/, '')
  return { model: row.id, base, apiKey: await resolverApiKey(db, row, base), esFallback: true }
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
  agotado?:  boolean   // se agotó el techo de espera (≠ error del proveedor)
  error?:    string
}

// `timeoutMs`: techo de espera. Sin él, un proveedor puede aceptar la petición y no
// devolver un solo byte (les pasa a los modelos recién salidos cuando están
// saturados), el health-check no termina nunca y la fila del admin se queda girando
// para siempre — había que recargar la página. Colgado se reporta como caído.
export async function probarModelo(id: string, timeoutMs = PRUEBA_LENTA_MS): Promise<PruebaModelo> {
  const db = createAdminClient()
  const [{ data: setRow }, row] = await Promise.all([
    db.from('settings').select('value').eq('key', 'ia_api_base').maybeSingle(),
    leerModelo(db, id),
  ])
  const base   = ((row?.api_base || setRow?.value || DEFAULT_BASE) as string).replace(/\/$/, '')
  const apiKey = await resolverApiKey(db, row, base)
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
      signal: AbortSignal.timeout(timeoutMs),
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
    const err = e as Error
    const ms = Date.now() - t0
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { ok: false, status: 0, ms, respondio: false, agotado: true, error: `No contestó en ${Math.round(timeoutMs / 1000)}s: demasiado lento para atender a un cliente.` }
    }
    return { ok: false, status: 0, ms, respondio: false, error: `red: ${err.message}` }
  }
}

const COLUMNAS_MODELO = 'id, activo, gratis, api_base, api_key_env, key_hint'

/**
 * El último recurso, resuelto del catálogo y no de una constante: el primer modelo
 * gratis activo y, si no hubiera ninguno gratis, el primer activo.
 *
 * `null` cuando no hay ni uno activo — que es una respuesta legítima («la IA no
 * está configurada») y no un hueco que tapar con un id inventado.
 *
 * La versión pura se exporta porque la misma regla la necesitan la pantalla
 * `/admin/ia` y el cron de salud, que ya tienen el catálogo cargado en memoria: si
 * cada uno la escribiera por su cuenta, acabarían discrepando de lo que el motor
 * hace de verdad. Espera la lista YA ordenada por `orden` (con `nombre` de
 * desempate), que es la prioridad que fija el admin.
 */
export function elegirUltimoRecurso<T extends { activo: boolean; gratis: boolean }>(modelos: T[]): T | null {
  return modelos.find(m => m.activo && m.gratis) ?? modelos.find(m => m.activo) ?? null
}

async function ultimoRecurso(db: ReturnType<typeof createAdminClient>): Promise<ModeloRow | null> {
  const { data } = await db.from('ia_modelos').select(COLUMNAS_MODELO)
    // `nombre` desempata: todos los modelos nuevos nacen con `orden` 100 y sin un
    // segundo criterio el último recurso lo elegía el orden físico de Postgres,
    // que cambia con cada UPDATE. El admin ordena igual, así que lo que enseña
    // como último recurso es lo que el motor va a coger de verdad.
    .eq('activo', true).order('orden').order('nombre')
  return elegirUltimoRecurso((data ?? []) as ModeloRow[])
}

async function leerModelo(db: ReturnType<typeof createAdminClient>, id: string): Promise<ModeloRow | null> {
  const { data } = await db.from('ia_modelos').select('id, activo, gratis, api_base, api_key_env, key_hint').eq('id', id).maybeSingle()
  return (data as ModeloRow | null) ?? null
}

async function conversacionesMes(db: ReturnType<typeof createAdminClient>, clientId: string): Promise<number> {
  const { data } = await db.from('ia_uso').select('conversaciones')
    .eq('client_id', clientId).eq('periodo', mesEnTz()).maybeSingle()
  return Number(data?.conversaciones) || 0
}
