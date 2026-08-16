'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'
import { actualizarTasasCliente } from '@/lib/tasas-auto'
// El contrato del resultado lo fija quien redacta el mensaje, para que la acción
// no pueda devolver algo que el toast no sepa contar.
import { diasDeTasa, type ResultadoTasas as ResultadoTasasAccion } from '@/lib/tasas-mensaje'
import { hoyEnTz } from '@/lib/fecha-tz'

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
  /**
   * Días desde esa fecha, resueltos EN EL SERVIDOR. La vista es un componente
   * cliente: si calculara «hoy» con el reloj del navegador, el SSR y la
   * hidratación podrían pintar días distintos. Además, la actualización
   * automática de madrugada mueve `fecha`, y este número es lo que hace que la
   * pantalla lo cuente («hoy») en vez de enseñar una fecha suelta.
   */
  dias?:     number | null
}

/**
 * Moneda tal como se ofrece en un selector del portal. El nombre es opcional:
 * quien solo tiene los códigos a mano (los módulos que cargan `monedas` como
 * string[]) puede pasar `{ codigo }` y el selector muestra solo el código.
 */
export interface MonedaOpcion {
  codigo:  string
  nombre?: string
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

// ── Monedas activas (para los selectores del portal) ──────────────────────────
//
// La ÚNICA fuente de monedas de cualquier selector: lo que el cliente tenga en
// Monedas y Tasas. Nunca una lista fija en el código — una moneda que el cliente
// no tiene no cotiza (no hay par ni tasa) y romperia conversiones y reportes.

export async function obtenerMonedasActivas(): Promise<MonedaOpcion[]> {
  const session = await getPortalSession()
  if (!session) return []
  const db = createAdminClient()
  const { data } = await db
    .from('monedas')
    .select('codigo, nombre')
    .eq('client_id', session.client_id)
    .eq('activa', true)
    .order('es_consolidacion', { ascending: false })
    .order('codigo')
  return (data ?? []) as MonedaOpcion[]
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

  const hoy = hoyEnTz()
  return (pares ?? []).map(p => {
    const r = rateMap.get(`${p.origen}__${p.destino}`)
    return { ...(p as Par), tasa: r?.tasa, fecha: r?.fecha, dias: diasDeTasa(r?.fecha, hoy) }
  })
}

// ── Guardar moneda (crear / editar) ───────────────────────────────────────────

export async function guardarMoneda(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa' || session.solo_lectura) return { ok: false, error: 'Sin permisos.' }

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
  // Configurar un par (cambiar su fuente o fijar una tasa manual) es modificar la
  // configuración: exige admin y NO solo-lectura. La excepción de solo-lectura es solo
  // el refresco masivo de tasas (`actualizarTasasAuto`), no editar el par a mano.
  if (!session || session.rol !== 'admin_empresa' || session.solo_lectura) return { ok: false, error: 'Sin permisos.' }

  const par_id     = parseInt((formData.get('par_id')  as string) ?? '0')
  const fuente     = ((formData.get('fuente') as string) ?? 'MANUAL') as Par['fuente']
  const tasaManual = parseFloat((formData.get('tasa')  as string) ?? '0')

  const db  = createAdminClient()
  const hoy = hoyEnTz()

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

    // El Toque SOLO cotiza moneda_extranjera ↔ CUP. En un par que no toca CUP (p.ej.
    // USD→EUR) el cálculo de abajo tomaba la tasa CUP del `origen` y la guardaba como si
    // fuera la del par —una tasa disparatada, en silencio—. Se rechaza antes de pedir nada.
    if (origen !== 'CUP' && destino !== 'CUP') {
      return { ok: false, error: 'El Toque solo cotiza pares que incluyan CUP. Usa Frankfurter o una tasa manual.' }
    }

    // El Toque siempre cotiza moneda_extranjera → CUP
    // Si el par es CUP→XXX usamos la tasa inversa
    const esCupOrigen = origen === 'CUP'
    const monedaExt   = esCupOrigen ? destino : origen
    const elToqueCod  = codElToque(monedaExt)

    try {
      const res  = await fetch('https://tasas.eltoque.com/v1/trmi', {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        cache:   'no-store',
        // Con la conexión de Cuba un fetch sin límite se queda colgado indefinidamente y
        // el usuario ve el spinner para siempre. 8 s y aborta (lo recoge el catch).
        signal:  AbortSignal.timeout(8000),
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
    const res  = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
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
  if (!session || session.rol !== 'admin_empresa' || session.solo_lectura) return { ok: false, error: 'Sin permisos.' }

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

export async function actualizarTasasAuto(): Promise<ResultadoTasasAccion> {
  const session = await getPortalSession()
  if (!session) return { ok: false, actualizadas: 0, sinCambios: 0, errores: ['Sin sesión.'] }

  // El núcleo vive en lib/tasas-auto (lo comparte el cron diario). Actualizar
  // tasas es la ÚNICA escritura que un usuario de solo-lectura sí puede hacer, así
  // que aquí basta con tener sesión — no se comprueba `solo_lectura`.
  const db = createAdminClient()
  const { actualizadas, sinCambios, errores } = await actualizarTasasCliente(db, session.client_id)

  revalidatePath('/portal/monedas')
  revalidatePath('/portal/dashboard')
  return { ok: true, actualizadas, sinCambios, errores }
}

// ── Uso / eliminación de monedas ──────────────────────────────────────────────
//
// Los códigos de moneda se guardan como texto plano (sin FK) en muchas tablas,
// así que la integridad es por convención: borrar la fila de `monedas` no rompe
// la BD pero deja referencias huérfanas. Por eso aquí controlamos el uso real
// antes de eliminar, y escopamos SIEMPRE por client_id (el mismo código —p.ej.
// "USD"— existe en varios clientes).

// (entidad legible, tabla, columna) de cada sitio que referencia un código.
const REF_MONEDA: { entidad: string; tabla: string; col: string }[] = [
  { entidad: 'Facturas',            tabla: 'facturas',              col: 'moneda' },
  { entidad: 'Ofertas',             tabla: 'ofertas',               col: 'moneda' },
  { entidad: 'Compras',             tabla: 'compras',               col: 'moneda' },
  { entidad: 'Gastos y cobros',     tabla: 'gastos_cobros',         col: 'moneda' },
  { entidad: 'Movimientos de caja', tabla: 'movimientos_tesoreria', col: 'moneda' },
  { entidad: 'Nóminas',             tabla: 'nominas',               col: 'moneda' },
  { entidad: 'Contratos',           tabla: 'contratos',             col: 'moneda' },
  { entidad: 'Empleados',           tabla: 'empleados',             col: 'moneda' },
  { entidad: 'Cuentas',             tabla: 'cuentas',               col: 'moneda' },
  { entidad: 'Terceros',            tabla: 'third_parties',         col: 'moneda_defecto' },
  { entidad: 'Empresas',            tabla: 'empresas',              col: 'moneda_funcional' },
]

export interface UsoMoneda {
  total:   number
  detalle: { entidad: string; n: number }[]
}

// Cuenta cuántos registros del cliente usan un código de moneda, por entidad.
export async function contarUsoMoneda(codigo: string): Promise<UsoMoneda> {
  const session = await getPortalSession()
  if (!session) return { total: 0, detalle: [] }
  const db = createAdminClient()

  const counts = await Promise.all(
    REF_MONEDA.map(async ref => {
      const { count } = await db
        .from(ref.tabla)
        .select('*', { count: 'exact', head: true })
        .eq('client_id', session.client_id)
        .eq(ref.col, codigo)
      return { entidad: ref.entidad, n: count ?? 0 }
    }),
  )

  // Los puntos de venta van aparte de REF_MONEDA: `monedas_aceptadas` es un text[],
  // así que la comprobación es de contención y no de igualdad como el resto.
  const { count: nCajas } = await db
    .from('cajas')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', session.client_id)
    .contains('monedas_aceptadas', [codigo])

  const detalle = [...counts, { entidad: 'Puntos de venta', n: nCajas ?? 0 }].filter(c => c.n > 0)
  return { total: detalle.reduce((s, c) => s + c.n, 0), detalle }
}

// Elimina una moneda de forma segura.
//  · No permite borrar la moneda de consolidación.
//  · Si no la usa ningún registro → borrado limpio (moneda + pares + tasas).
//  · Si la usan registros y NO se pide fusión → se bloquea (desactivar o fusionar).
//  · Si se pide `fusionarEn` → reasigna esos registros a esa moneda y borra la
//    vieja. NO convierte importes: la fusión es para duplicados/typos del mismo
//    valor (p.ej. una moneda creada por error). Para monedas realmente distintas
//    lo correcto es desactivar, no fusionar.
export async function eliminarMoneda(
  codigo:      string,
  fusionarEn?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa' || session.solo_lectura) return { ok: false, error: 'Sin permisos.' }

  const db = createAdminClient()

  const { data: mon } = await db
    .from('monedas')
    .select('es_consolidacion')
    .eq('client_id', session.client_id)
    .eq('codigo', codigo)
    .maybeSingle()

  if (!mon) return { ok: false, error: 'Moneda no encontrada.' }
  if (mon.es_consolidacion) {
    return { ok: false, error: 'Es la moneda de consolidación. Cambia la consolidación antes de eliminarla.' }
  }

  const uso = await contarUsoMoneda(codigo)

  if (uso.total > 0) {
    if (!fusionarEn) {
      return { ok: false, error: `La usan ${uso.total} registro(s). Desactívala o fusiónala con otra moneda.` }
    }
    if (fusionarEn === codigo) return { ok: false, error: 'Elige una moneda destino distinta.' }

    const { data: destino } = await db
      .from('monedas')
      .select('moneda_id')
      .eq('client_id', session.client_id)
      .eq('codigo', fusionarEn)
      .eq('activa', true)
      .maybeSingle()
    if (!destino) return { ok: false, error: `La moneda destino "${fusionarEn}" no existe o está inactiva.` }

    // Reasignar el código en cada tabla (sin tocar importes).
    for (const ref of REF_MONEDA) {
      const { error } = await db
        .from(ref.tabla)
        .update({ [ref.col]: fusionarEn })
        .eq('client_id', session.client_id)
        .eq(ref.col, codigo)
      if (error) return { ok: false, error: `Error al fusionar en ${ref.entidad}.` }
    }

    // Los puntos de venta van aparte: `monedas_aceptadas` es text[] y NO lo cubre el bucle
    // de REF_MONEDA (columnas escalares). Sin migrarlo, la caja se queda aceptando un código
    // que se borra dos líneas más abajo → moneda huérfana en el TPV. Se reescribe el array
    // de cada punto que la aceptaba, sustituyéndola por el destino (sin duplicar si ya lo
    // tenía). Se hace en JS porque array_remove/append de Postgres no se expresan en el
    // update de supabase-js, y el número de cajas por cliente es pequeño.
    const { data: cajasAfectadas } = await db
      .from('cajas')
      .select('caja_id, monedas_aceptadas')
      .eq('client_id', session.client_id)
      .contains('monedas_aceptadas', [codigo])
    for (const caja of cajasAfectadas ?? []) {
      const actuales = Array.isArray(caja.monedas_aceptadas) ? caja.monedas_aceptadas as string[] : []
      const nuevas   = Array.from(new Set(actuales.map(c => (c === codigo ? fusionarEn : c))))
      const { error } = await db
        .from('cajas')
        .update({ monedas_aceptadas: nuevas })
        .eq('client_id', session.client_id)
        .eq('caja_id', caja.caja_id)
      if (error) return { ok: false, error: 'Error al fusionar en Puntos de venta.' }
    }
  }

  // Purgar la configuración de cambio del código y la propia moneda.
  await db.from('tasas_cambio').delete()
    .eq('client_id', session.client_id)
    .or(`moneda_origen.eq.${codigo},moneda_destino.eq.${codigo}`)
  await db.from('pares_tasa').delete()
    .eq('client_id', session.client_id)
    .or(`origen.eq.${codigo},destino.eq.${codigo}`)

  const { error } = await db.from('monedas').delete()
    .eq('client_id', session.client_id)
    .eq('codigo', codigo)
  if (error) return { ok: false, error: 'Error al eliminar la moneda.' }

  revalidatePath('/portal/monedas')
  revalidatePath('/portal/empresas')
  return { ok: true }
}
