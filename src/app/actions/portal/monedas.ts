'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'
import { CATALOGO_MONEDAS } from '@/lib/monedas-catalogo'

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface Moneda {
  moneda_id:        number
  client_id:        string
  codigo:           string
  nombre:           string
  simbolo:          string
  es_consolidacion: boolean
  activa:           boolean
  created_at:       string
}

export interface Par {
  par_id:    number
  client_id: string
  origen:    string
  destino:   string
  fuente:    'EL_TOQUE' | 'FRANKFURTER' | 'MANUAL'
  activo:    boolean
  tasa?:     number
  fecha?:    string
}

// ── Constantes internas ───────────────────────────────────────────────────────

// El Toque usa código propio para el Euro
const EL_TOQUE_MAPA: Record<string, string> = { EUR: 'ECU' }
function codElToque(cod: string): string { return EL_TOQUE_MAPA[cod] ?? cod }

// Monedas que Frankfurter reconoce (pares entre ellas usan API internacional)
const FRANKFURTER_CODS = new Set(['USD', 'EUR', 'GBP', 'MXN', 'CAD', 'JPY', 'CHF', 'AUD'])

// Prioridad para determinar la dirección canónica del par (menor índice = origen)
// CUP siempre va como destino cuando está involucrado.
const PRIORIDAD = ['USD', 'EUR', 'GBP', 'CAD', 'MXN', 'MLC']

function parCanonico(a: string, b: string): [string, string] {
  if (b === 'CUP') return [a, b]
  if (a === 'CUP') return [b, a]
  const pa = PRIORIDAD.indexOf(a)
  const pb = PRIORIDAD.indexOf(b)
  if (pa === -1 && pb === -1) return a < b ? [a, b] : [b, a]
  if (pa === -1) return [b, a]
  if (pb === -1) return [a, b]
  return pa <= pb ? [a, b] : [b, a]
}

function fuenteDefecto(origen: string, destino: string): Par['fuente'] {
  if (destino === 'CUP') return 'EL_TOQUE'
  if (FRANKFURTER_CODS.has(origen) && FRANKFURTER_CODS.has(destino)) return 'FRANKFURTER'
  return 'MANUAL'
}

// ── Obtener monedas ───────────────────────────────────────────────────────────

export async function obtenerMonedas(): Promise<Moneda[]> {
  const session = await getPortalSession()
  if (!session) return []
  const db = createAdminClient()
  const { data } = await db
    .from('monedas')
    .select('*')
    .eq('client_id', session.client_id)
    .order('es_consolidacion', { ascending: false })
    .order('codigo')
  return (data as Moneda[]) ?? []
}

// ── Obtener pares con tasa vigente ────────────────────────────────────────────

export async function obtenerPares(): Promise<Par[]> {
  const session = await getPortalSession()
  if (!session) return []
  const db = createAdminClient()

  const [{ data: pares }, { data: tasas }] = await Promise.all([
    db.from('pares_tasa')
      .select('*')
      .eq('client_id', session.client_id)
      .eq('activo', true)
      .order('origen')
      .order('destino'),
    db.from('tasas_cambio')
      .select('moneda_origen, moneda_destino, tasa, fecha')
      .eq('client_id', session.client_id)
      .order('fecha', { ascending: false })
      .order('tasa_id', { ascending: false }),
  ])

  // Tasa más reciente por par
  const rateMap = new Map<string, { tasa: number; fecha: string }>()
  for (const t of (tasas ?? [])) {
    const key = `${t.moneda_origen}__${t.moneda_destino}`
    if (!rateMap.has(key)) rateMap.set(key, { tasa: t.tasa, fecha: t.fecha })
  }

  return (pares ?? []).map(p => ({
    ...(p as Par),
    tasa:  rateMap.get(`${p.origen}__${p.destino}`)?.tasa,
    fecha: rateMap.get(`${p.origen}__${p.destino}`)?.fecha,
  }))
}

// ── Guardar moneda (crear / editar) ───────────────────────────────────────────

export async function guardarMoneda(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa') return { ok: false, error: 'Sin permisos.' }

  const codigoOriginal = ((formData.get('codigo_original') as string) ?? '').trim()
  const catalogo       = ((formData.get('catalogo')        as string) ?? '').trim()
  const codigoCustom   = ((formData.get('codigo')          as string) ?? '').trim().toUpperCase()
  const codigo         = catalogo && catalogo !== 'OTRA' ? catalogo : codigoCustom
  const nombre         = ((formData.get('nombre')          as string) ?? '').trim()
  const simbolo        = ((formData.get('simbolo')         as string) ?? '').trim()
  const activa         = formData.get('activa') !== 'false'

  if (!codigo || codigo.length < 2) return { ok: false, error: 'El código es obligatorio (mín. 2 caracteres).' }
  if (!nombre)                       return { ok: false, error: 'El nombre es obligatorio.' }

  const db = createAdminClient()

  if (!codigoOriginal) {
    // ── Crear ──────────────────────────────────────────────────────────────
    const { data: existe } = await db
      .from('monedas')
      .select('moneda_id')
      .eq('client_id', session.client_id)
      .eq('codigo', codigo)
      .maybeSingle()

    if (existe) return { ok: false, error: `La moneda "${codigo}" ya existe.` }

    const { error } = await db.from('monedas').insert({
      client_id:        session.client_id,
      codigo,
      nombre,
      simbolo:          simbolo || codigo,
      es_consolidacion: false,
      activa:           true,
    })
    if (error) return { ok: false, error: 'Error al crear la moneda.' }

    // Generar pares canónicos con las monedas activas existentes
    const { data: existentes } = await db
      .from('monedas')
      .select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .neq('codigo', codigo)

    if (existentes?.length) {
      const pares = existentes.map(m => {
        const [orig, dest] = parCanonico(codigo, m.codigo)
        return {
          client_id: session.client_id,
          origen:    orig,
          destino:   dest,
          fuente:    fuenteDefecto(orig, dest),
          activo:    true,
        }
      })
      await db
        .from('pares_tasa')
        .upsert(pares, { onConflict: 'client_id,origen,destino', ignoreDuplicates: true })
    }
  } else {
    // ── Editar ─────────────────────────────────────────────────────────────
    const { data: mon } = await db
      .from('monedas')
      .select('es_consolidacion')
      .eq('client_id', session.client_id)
      .eq('codigo', codigoOriginal)
      .single()

    const { error } = await db
      .from('monedas')
      .update({
        nombre,
        simbolo:  simbolo || codigoOriginal,
        activa:   mon?.es_consolidacion ? true : activa,
      })
      .eq('client_id', session.client_id)
      .eq('codigo', codigoOriginal)

    if (error) return { ok: false, error: 'Error al actualizar la moneda.' }
  }

  revalidatePath('/portal/monedas')
  revalidatePath('/portal/empresas')
  return { ok: true }
}

// ── Guardar configuración de un par (fuente + tasa si manual) ────────────────

export async function guardarPar(
  formData: FormData,
): Promise<{ ok: boolean; tasa?: number; fecha?: string; error?: string }> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa') return { ok: false, error: 'Sin permisos.' }

  const par_id     = parseInt((formData.get('par_id')  as string) ?? '0')
  const fuente     = ((formData.get('fuente') as string) ?? 'MANUAL') as Par['fuente']
  const tasaManual = parseFloat((formData.get('tasa')  as string) ?? '0')

  const db  = createAdminClient()
  const hoy = new Date().toISOString().split('T')[0]

  const { data: par } = await db
    .from('pares_tasa')
    .select('origen, destino')
    .eq('par_id', par_id)
    .eq('client_id', session.client_id)
    .single()

  if (!par) return { ok: false, error: 'Par no encontrado.' }

  // Actualizar fuente en la configuración del par
  const { error: errUpdate } = await db
    .from('pares_tasa')
    .update({ fuente })
    .eq('par_id', par_id)
    .eq('client_id', session.client_id)

  if (errUpdate) return { ok: false, error: 'Error al actualizar la fuente.' }

  if (fuente === 'MANUAL') {
    if (isNaN(tasaManual) || tasaManual <= 0) return { ok: false, error: 'La tasa debe ser mayor que cero.' }
    const { error } = await db.from('tasas_cambio').insert({
      client_id:      session.client_id,
      moneda_origen:  par.origen,
      moneda_destino: par.destino,
      tasa:           tasaManual,
      fuente:         'MANUAL',
      fecha:          hoy,
    })
    if (error) return { ok: false, error: 'Error al guardar la tasa.' }
    revalidatePath('/portal/monedas')
    return { ok: true, tasa: tasaManual, fecha: hoy }
  }

  // Fuente automática: obtener tasa ahora
  const result = await fetchTasaPar(session.client_id, par.origen, par.destino, fuente, hoy, db)
  if (result.ok) revalidatePath('/portal/monedas')
  return result
}

// ── Helper: obtener tasa de un par vía API ────────────────────────────────────

async function fetchTasaPar(
  clientId: string,
  origen:   string,
  destino:  string,
  fuente:   'EL_TOQUE' | 'FRANKFURTER',
  fecha:    string,
  db:       ReturnType<typeof createAdminClient>,
): Promise<{ ok: boolean; tasa?: number; fecha?: string; error?: string }> {

  if (fuente === 'EL_TOQUE') {
    const apiKey = process.env.ELTOQUE_API_KEY
    if (!apiKey) return { ok: false, error: 'Sin ELTOQUE_API_KEY configurada.' }

    // El Toque siempre cotiza moneda_extranjera → CUP
    // Si el par es CUP→XXX usamos la tasa inversa
    const esCupOrigen = origen === 'CUP'
    const monedaExt   = esCupOrigen ? destino : origen
    const elToqueCod  = codElToque(monedaExt)

    try {
      const res  = await fetch('https://tasas.eltoque.com/v1/trmi', {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        cache:   'no-store',
      })
      if (!res.ok) return { ok: false, error: `El Toque HTTP ${res.status}` }

      const json = await res.json() as { tasas?: Record<string, number> }
      const tasaExt = json.tasas?.[elToqueCod]
      if (!tasaExt) return { ok: false, error: `El Toque: sin tasa para ${monedaExt} (código ${elToqueCod})` }

      const tasa = esCupOrigen ? 1 / tasaExt : tasaExt
      const { error } = await db.from('tasas_cambio').insert({
        client_id: clientId, moneda_origen: origen, moneda_destino: destino,
        tasa, fuente: 'EL_TOQUE', fecha,
      })
      if (error) return { ok: false, error: `DB: ${error.message}` }
      return { ok: true, tasa, fecha }
    } catch (e) {
      return { ok: false, error: `El Toque: ${e instanceof Error ? e.message : 'error'}` }
    }
  }

  // FRANKFURTER
  try {
    const url  = `https://api.frankfurter.app/latest?base=${origen}&symbols=${destino}`
    const res  = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { ok: false, error: `Frankfurter HTTP ${res.status}` }

    const json = await res.json() as { rates?: Record<string, number> }
    const tasa = json.rates?.[destino]
    if (!tasa) return { ok: false, error: `Frankfurter: sin tasa para ${origen}/${destino}` }

    const { error } = await db.from('tasas_cambio').insert({
      client_id: clientId, moneda_origen: origen, moneda_destino: destino,
      tasa, fuente: 'FRANKFURTER', fecha,
    })
    if (error) return { ok: false, error: `DB: ${error.message}` }
    return { ok: true, tasa, fecha }
  } catch (e) {
    return { ok: false, error: `Frankfurter: ${e instanceof Error ? e.message : 'error'}` }
  }
}

// ── Cambiar moneda de consolidación ──────────────────────────────────────────

export async function cambiarMonedaConsolidacion(
  nuevoCodigo: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa') return { ok: false, error: 'Sin permisos.' }

  const db = createAdminClient()
  const { data: mon } = await db
    .from('monedas')
    .select('moneda_id')
    .eq('client_id', session.client_id)
    .eq('codigo', nuevoCodigo)
    .maybeSingle()

  if (!mon) return { ok: false, error: `Moneda "${nuevoCodigo}" no encontrada.` }

  await db.from('monedas').update({ es_consolidacion: false }).eq('client_id', session.client_id).eq('es_consolidacion', true)
  await db.from('monedas').update({ es_consolidacion: true, activa: true }).eq('client_id', session.client_id).eq('codigo', nuevoCodigo)

  revalidatePath('/portal/monedas')
  return { ok: true }
}

// ── Actualizar todas las tasas automáticas ────────────────────────────────────

export async function actualizarTasasAuto(): Promise<{
  ok: boolean
  actualizadas: number
  errores: string[]
}> {
  const session = await getPortalSession()
  if (!session) return { ok: false, actualizadas: 0, errores: ['Sin sesión.'] }

  const db = createAdminClient()
  const { data: pares } = await db
    .from('pares_tasa')
    .select('par_id, origen, destino, fuente')
    .eq('client_id', session.client_id)
    .eq('activo', true)
    .neq('fuente', 'MANUAL')

  if (!pares?.length) return { ok: true, actualizadas: 0, errores: ['No hay pares con fuente automática.'] }

  const hoy      = new Date().toISOString().split('T')[0]
  const errores: string[] = []
  let   actualizadas = 0

  // ── El Toque: una sola llamada para todos los pares EL_TOQUE ──────────────
  const paresElToque = pares.filter(p => p.fuente === 'EL_TOQUE')
  if (paresElToque.length > 0) {
    const apiKey = process.env.ELTOQUE_API_KEY
    if (!apiKey) {
      errores.push('El Toque: configura ELTOQUE_API_KEY en .env.local')
    } else {
      try {
        const res  = await fetch('https://tasas.eltoque.com/v1/trmi', {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          cache:   'no-store',
        })
        if (!res.ok) {
          errores.push(`El Toque HTTP ${res.status}`)
        } else {
          const json = await res.json() as { tasas?: Record<string, number> }
          if (!json.tasas) {
            errores.push('El Toque: respuesta sin campo "tasas"')
          } else {
            const inserts: Record<string, unknown>[] = []
            for (const par of paresElToque) {
              const esCupOrigen = par.origen === 'CUP'
              const monedaExt   = esCupOrigen ? par.destino : par.origen
              const elToqueCod  = codElToque(monedaExt)
              const tasaExt     = json.tasas[elToqueCod]
              if (!tasaExt) {
                errores.push(`El Toque: sin tasa para ${monedaExt} (código ${elToqueCod})`)
                continue
              }
              inserts.push({
                client_id:      session.client_id,
                moneda_origen:  par.origen,
                moneda_destino: par.destino,
                tasa:           esCupOrigen ? 1 / tasaExt : tasaExt,
                fuente:         'EL_TOQUE',
                fecha:          hoy,
              })
            }
            if (inserts.length > 0) {
              const { error } = await db.from('tasas_cambio').insert(inserts)
              if (error) errores.push(`El Toque DB: ${error.message}`)
              else actualizadas += inserts.length
            }
          }
        }
      } catch (e) {
        const cause = (e instanceof Error && (e as NodeJS.ErrnoException).cause)
          ? ` — ${String((e as NodeJS.ErrnoException).cause)}`
          : ''
        errores.push(`El Toque: ${e instanceof Error ? e.message : 'error'}${cause}`)
      }
    }
  }

  // ── Frankfurter: agrupado por moneda base para minimizar llamadas ─────────
  const paresFrank = pares.filter(p => p.fuente === 'FRANKFURTER')
  if (paresFrank.length > 0) {
    const byOrigen = new Map<string, typeof paresFrank>()
    for (const p of paresFrank) {
      if (!byOrigen.has(p.origen)) byOrigen.set(p.origen, [])
      byOrigen.get(p.origen)!.push(p)
    }
    for (const [base, grupo] of byOrigen) {
      const symbols = grupo.map(p => p.destino).join(',')
      try {
        const url  = `https://api.frankfurter.app/latest?base=${base}&symbols=${symbols}`
        const res  = await fetch(url, { cache: 'no-store' })
        if (!res.ok) { errores.push(`Frankfurter HTTP ${res.status} (base ${base})`); continue }
        const json = await res.json() as { rates?: Record<string, number> }
        if (!json.rates) { errores.push(`Frankfurter: respuesta inesperada (base ${base})`); continue }
        const inserts = Object.entries(json.rates).map(([cod, valor]) => ({
          client_id:      session.client_id,
          moneda_origen:  base,
          moneda_destino: cod,
          tasa:           valor,
          fuente:         'FRANKFURTER',
          fecha:          hoy,
        }))
        const { error } = await db.from('tasas_cambio').insert(inserts)
        if (error) errores.push(`Frankfurter DB (${base}): ${error.message}`)
        else actualizadas += inserts.length
      } catch (e) {
        errores.push(`Frankfurter (${base}): ${e instanceof Error ? e.message : 'error'}`)
      }
    }
  }

  revalidatePath('/portal/monedas')
  return { ok: true, actualizadas, errores }
}
