'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { tieneModulo } from '@/lib/modulos'
import { hoyEnTz } from '@/lib/fecha-tz'
import { optimizarImagen } from '@/lib/imagen/optimizar'
import { getPortalSession } from './auth'
import { obtenerEmpresas } from './empresas'
import { construirSnapshotDesdeBase, type LineaDesglose } from '@/lib/dossier/base'
import { fusionarSerie, resolverFusion, type FilaSerie, type PlanFusion } from '@/lib/dossier/snapshot'
import { SECCIONES_RELATO } from '@/lib/dossier/secciones'
import { normalizarHex } from '@/lib/dossier/paleta'

// ── Funcionalidad "Dossier del negocio" (clave `dossier`) ──
// Independiente: funciona a mano sin la base. Con `base`, puede TRAER los números
// (llenado rápido) con fusión NO destructiva. Todo scoped por `client_id`.
// v1 gestiona UN dossier por cliente (el modelo ya soporta varios).

export interface TasaUsada { tasa: number; fecha: string | null }

export interface DossierBasico {
  dossier_id:              string
  titulo:                  string
  estado:                  'BORRADOR' | 'PUBLICADO'
  empresa_id:              string | null
  moneda_presentacion:     string
  color_principal:         string
  logo_url:                string | null
  periodo_desde:           string | null
  periodo_hasta:           string | null
  crecimiento_mensual_pct: number
  snapshot_at:             string | null
  token:                   string | null
  monedas_faltantes:       string[]
  tasas_usadas:            Record<string, TasaUsada>
}

export interface CategoriaCosto { categoria: string; es_costo_ventas: boolean }

export interface SeccionRelato { clave: string; cuerpo: string; generado_ia: boolean }

export interface DossierData {
  dossier:            DossierBasico | null   // null = aún no hay dossier
  serie:              FilaSerie[]
  lineas:             LineaDesglose[]
  secciones:          SeccionRelato[]
  tieneBase:          boolean
  tieneRrhh:          boolean                 // solo habilita precargar Equipo
  multiempresa:       boolean
  empresas:           { empresa_id: string; nombre: string }[]
  monedas:            { codigo: string; simbolo: string }[]
  monedaConsolidacion: string | null
  categoriasCosto:    CategoriaCosto[]        // vacío sin base
  empresaLogoUrl:     string | null           // habilita "usar el logo de mi empresa"
}

// Plan de fusión + monedas faltantes de la previsualización (serializable al cliente).
export interface PreviewActualizacion extends PlanFusion {
  monedasFaltantes: string[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function genId(prefijo: string): string {
  return `${prefijo}-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

// Período por defecto: últimos 12 meses (desde el día 1 de hace 11 meses hasta hoy).
function periodo12(): { desde: string; hasta: string } {
  const hoy = hoyEnTz()
  const [y, m] = hoy.split('-').map(Number)
  const idx = y * 12 + (m - 1) - 11
  const dy = Math.floor(idx / 12)
  const dm = (idx % 12) + 1
  return { desde: `${dy}-${String(dm).padStart(2, '0')}-01`, hasta: hoy }
}

type Db = ReturnType<typeof createAdminClient>

async function modulosDelCliente(db: Db, clientId: string): Promise<string[]> {
  const { data } = await db.from('clients').select('modulos_activos').eq('client_id', clientId).maybeSingle()
  return Array.isArray(data?.modulos_activos) ? (data!.modulos_activos as string[]) : []
}

// Resuelve las empresas del dossier: null = todas las accesibles (consolidado).
async function empresaIdsDe(empresaId: string | null): Promise<string[]> {
  const empresas = await obtenerEmpresas()
  if (empresaId) return [empresaId]
  return empresas.map(e => e.empresa_id)
}

// Logo de la empresa del dossier (o de la primera accesible en el consolidado):
// solo para OFRECER copiarlo. El dossier nunca depende de él.
async function logoDeEmpresa(empresaId: string | null): Promise<string | null> {
  const empresas = await obtenerEmpresas()
  const e = empresaId ? empresas.find(x => x.empresa_id === empresaId) : empresas[0]
  return e?.logo_url ?? null
}

async function clasificacionCosto(db: Db, clientId: string): Promise<Map<string, boolean>> {
  const { data } = await db.from('dossier_costo_ventas')
    .select('categoria, es_costo_ventas').eq('client_id', clientId)
  const m = new Map<string, boolean>()
  for (const r of (data ?? []) as CategoriaCosto[]) m.set(r.categoria, r.es_costo_ventas)
  return m
}

// Escribe el snapshot atómicamente vía la RPC (delete + insert + update).
async function escribirSnapshot(
  db: Db, dossierId: string, clientId: string,
  serie: FilaSerie[], lineas: LineaDesglose[],
  tasas: Record<string, unknown>, faltantes: string[],
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.rpc('dossier_guardar_snapshot', {
    p_dossier_id: dossierId,
    p_client_id:  clientId,
    p_serie:      serie,
    p_lineas:     lineas,
    p_tasas:      tasas,
    p_faltantes:  faltantes,
  })
  if (error) return { ok: false, error: 'No se pudo guardar el snapshot.' }
  return { ok: true }
}

// ── Lectura ─────────────────────────────────────────────────────────────────────

export async function obtenerDossier(): Promise<DossierData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const [modulos, empresas, { data: monedasRows }, { data: dosRow }] = await Promise.all([
    modulosDelCliente(db, session.client_id),
    obtenerEmpresas(),
    // `activa`: mismo criterio que el aviso de setup del dashboard — una moneda
    // dada de baja no es una opción de presentación.
    db.from('monedas').select('codigo, simbolo, es_consolidacion').eq('client_id', session.client_id).eq('activa', true),
    db.from('dossiers').select('*').eq('client_id', session.client_id)
      .order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ])

  const tieneBase    = tieneModulo(modulos, 'base')
  const tieneRrhh    = tieneModulo(modulos, 'rrhh')
  const multiempresa = tieneModulo(modulos, 'multiempresa')
  const monedas = (monedasRows ?? []).map((m: { codigo: string; simbolo: string | null }) => ({ codigo: m.codigo, simbolo: m.simbolo || m.codigo }))
  const monedaConsolidacion = (monedasRows ?? []).find((m: { es_consolidacion: boolean }) => m.es_consolidacion)?.codigo ?? null

  const categoriasCosto = tieneBase ? await obtenerCategoriasGasto() : []
  const listaEmpresas = empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre }))

  if (!dosRow) {
    return {
      dossier: null, serie: [], lineas: [], secciones: [],
      tieneBase, tieneRrhh, multiempresa, empresas: listaEmpresas,
      monedas, monedaConsolidacion, categoriasCosto, empresaLogoUrl: null,
    }
  }

  const dossierId = dosRow.dossier_id as string
  const [{ data: serieRows }, { data: lineaRows }, { data: seccionRows }] = await Promise.all([
    db.from('dossier_serie').select('mes, ingresos, costo_ventas, gastos_operativos, moneda, origen')
      .eq('dossier_id', dossierId).eq('client_id', session.client_id).order('mes'),
    db.from('dossier_lineas').select('grupo, concepto, monto, orden')
      .eq('dossier_id', dossierId).eq('client_id', session.client_id).order('orden'),
    db.from('dossier_secciones').select('clave, cuerpo, generado_ia')
      .eq('dossier_id', dossierId).eq('client_id', session.client_id).order('orden'),
  ])

  const serie: FilaSerie[] = (serieRows ?? []).map((r: Record<string, unknown>) => ({
    mes: r.mes as string,
    ingresos: Number(r.ingresos), costo_ventas: Number(r.costo_ventas), gastos_operativos: Number(r.gastos_operativos),
    moneda: r.moneda as string, origen: (r.origen === 'BASE' ? 'BASE' : 'MANUAL'),
  }))
  const lineas: LineaDesglose[] = (lineaRows ?? []).map((r: Record<string, unknown>) => ({
    grupo: r.grupo as LineaDesglose['grupo'], concepto: r.concepto as string, monto: Number(r.monto), orden: Number(r.orden),
  }))
  const secciones: SeccionRelato[] = (seccionRows ?? []).map((r: Record<string, unknown>) => ({
    clave: r.clave as string, cuerpo: (r.cuerpo as string) ?? '', generado_ia: !!r.generado_ia,
  }))

  const dossier: DossierBasico = {
    dossier_id: dossierId,
    titulo: dosRow.titulo,
    estado: dosRow.estado,
    empresa_id: dosRow.empresa_id ?? null,
    moneda_presentacion: dosRow.moneda_presentacion,
    color_principal: dosRow.color_principal,
    logo_url: dosRow.logo_url ?? null,
    periodo_desde: dosRow.periodo_desde ?? null,
    periodo_hasta: dosRow.periodo_hasta ?? null,
    crecimiento_mensual_pct: Number(dosRow.crecimiento_mensual_pct) || 0,
    snapshot_at: dosRow.snapshot_at ?? null,
    token: dosRow.token ?? null,
    monedas_faltantes: Array.isArray(dosRow.monedas_faltantes) ? dosRow.monedas_faltantes : [],
    tasas_usadas: (dosRow.tasas_usadas && typeof dosRow.tasas_usadas === 'object') ? dosRow.tasas_usadas as Record<string, TasaUsada> : {},
  }

  return {
    dossier, serie, lineas, secciones,
    tieneBase, tieneRrhh, multiempresa, empresas: listaEmpresas,
    monedas, monedaConsolidacion, categoriasCosto,
    empresaLogoUrl: await logoDeEmpresa(dossier.empresa_id),
  }
}

// Categorías de gasto reales del cliente + su clasificación (coste de ventas o no).
export async function obtenerCategoriasGasto(): Promise<CategoriaCosto[]> {
  const session = await getPortalSession()
  if (!session) return []

  const db = createAdminClient()
  const [{ data: gastos }, clasif] = await Promise.all([
    db.from('gastos_cobros').select('categoria').eq('client_id', session.client_id).eq('tipo', 'GASTO'),
    clasificacionCosto(db, session.client_id),
  ])

  const categorias = new Set<string>()
  for (const g of (gastos ?? []) as { categoria: string | null }[]) categorias.add(g.categoria || 'Sin categoría')

  return [...categorias].sort((a, b) => a.localeCompare(b))
    .map(categoria => ({ categoria, es_costo_ventas: clasif.get(categoria) ?? false }))
}

// ── Mutación ──────────────────────────────────────────────────────────────────

export async function crearDossier(formData: FormData): Promise<{ ok: boolean; error?: string; dossier_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  // v1: un dossier por cliente. Si ya existe, no se crea otro.
  const { data: ya } = await db.from('dossiers').select('dossier_id').eq('client_id', session.client_id).limit(1).maybeSingle()
  if (ya) return { ok: false, error: 'Ya existe un dossier.' }

  const titulo   = (formData.get('titulo') as string)?.trim() || 'Dossier para inversores'
  const empresaId = (formData.get('empresa_id') as string)?.trim() || null
  const moneda   = (formData.get('moneda_presentacion') as string)?.trim()
  if (!moneda) return { ok: false, error: 'Falta la moneda de presentación.' }

  const fallback = periodo12()
  const desde = (formData.get('periodo_desde') as string)?.trim() || fallback.desde
  const hasta = (formData.get('periodo_hasta') as string)?.trim() || fallback.hasta

  const dossier_id = genId('DOS')
  const { error } = await db.from('dossiers').insert({
    dossier_id, client_id: session.client_id,
    empresa_id: empresaId, titulo, estado: 'BORRADOR',
    moneda_presentacion: moneda, periodo_desde: desde, periodo_hasta: hasta,
  })
  if (error) return { ok: false, error: 'No se pudo crear el dossier.' }

  revalidatePath('/portal/dossier')
  return { ok: true, dossier_id }
}

// Actualiza lo básico (título, empresa, período, moneda, crecimiento).
export async function guardarBasicos(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const set = (k: string, v: unknown) => { if (v !== null && v !== undefined && v !== '') patch[k] = v }
  set('titulo', (formData.get('titulo') as string)?.trim())
  set('moneda_presentacion', (formData.get('moneda_presentacion') as string)?.trim())
  set('periodo_desde', (formData.get('periodo_desde') as string)?.trim())
  set('periodo_hasta', (formData.get('periodo_hasta') as string)?.trim())
  if (formData.has('empresa_id')) patch.empresa_id = (formData.get('empresa_id') as string)?.trim() || null
  if (formData.has('crecimiento_mensual_pct')) patch.crecimiento_mensual_pct = Number(formData.get('crecimiento_mensual_pct')) || 0

  const db = createAdminClient()
  const { error } = await db.from('dossiers').update(patch).eq('dossier_id', dossierId).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo guardar.' }

  revalidatePath('/portal/dossier')
  return { ok: true }
}

// Guarda la serie tecleada a mano (o el estado tras una fusión). La rejilla ES la
// fuente sin base: guardar aquí = actualizar el snapshot. Escribe vía la RPC.
export async function guardarSerie(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  const { data: dos } = await db.from('dossiers').select('moneda_presentacion, tasas_usadas, monedas_faltantes')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { ok: false, error: 'Dossier no encontrado.' }

  let entrada: Array<Partial<FilaSerie>>
  try { entrada = JSON.parse((formData.get('serie') as string) || '[]') } catch { return { ok: false, error: 'Datos inválidos.' } }

  const serie: FilaSerie[] = entrada
    .filter(f => f && typeof f.mes === 'string')
    .map(f => ({
      mes: f.mes as string,
      ingresos: Number(f.ingresos) || 0,
      costo_ventas: Number(f.costo_ventas) || 0,
      gastos_operativos: Number(f.gastos_operativos) || 0,
      moneda: dos.moneda_presentacion,
      origen: f.origen === 'BASE' ? 'BASE' : 'MANUAL',
    }))

  // Edición manual: reescribe solo la serie. CONSERVA la procedencia del snapshot
  // (tasas y monedas faltantes de un "traer" previo; sin base son {}). El desglose
  // por categoría (líneas) SÍ se descarta: viene de la base y un retoque a mano lo
  // dejaría descuadrado frente a los totales. Se regenera al "Actualizar".
  const tasas = (dos.tasas_usadas && typeof dos.tasas_usadas === 'object') ? dos.tasas_usadas as Record<string, unknown> : {}
  const faltantes = Array.isArray(dos.monedas_faltantes) ? dos.monedas_faltantes as string[] : []
  const res = await escribirSnapshot(db, dossierId, session.client_id, serie, [], tasas, faltantes)
  if (!res.ok) return res

  revalidatePath('/portal/dossier')
  return { ok: true }
}

// Guarda la clasificación coste de ventas (nivel cliente; el 2º dossier la hereda).
export async function guardarCostoVentas(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  let entrada: CategoriaCosto[]
  try { entrada = JSON.parse((formData.get('clasificacion') as string) || '[]') } catch { return { ok: false, error: 'Datos inválidos.' } }

  const db = createAdminClient()
  const filas = entrada
    .filter(c => c && typeof c.categoria === 'string')
    .map(c => ({ client_id: session.client_id, categoria: c.categoria, es_costo_ventas: !!c.es_costo_ventas, updated_at: new Date().toISOString() }))

  if (filas.length) {
    const { error } = await db.from('dossier_costo_ventas').upsert(filas, { onConflict: 'client_id,categoria' })
    if (error) return { ok: false, error: 'No se pudo guardar la clasificación.' }
  }

  revalidatePath('/portal/dossier')
  return { ok: true }
}

// ── Relato ─────────────────────────────────────────────────────────────────────

// Guarda las secciones escritas. Upsert por (dossier_id, clave): el dueño puede
// dejar una vacía y volver luego; una sección sin cuerpo se guarda invisible para
// que no salga como un hueco en el deck.
export async function guardarSecciones(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  let entrada: { clave: string; cuerpo: string; generado_ia?: boolean }[]
  try { entrada = JSON.parse((formData.get('secciones') as string) || '[]') } catch { return { ok: false, error: 'Datos inválidos.' } }

  const db = createAdminClient()
  const { data: dos } = await db.from('dossiers').select('dossier_id')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { ok: false, error: 'Dossier no encontrado.' }

  const validas = new Set(SECCIONES_RELATO.map(s => s.clave as string))
  const filas = entrada
    .filter(s => s && validas.has(s.clave))
    .map(s => {
      const cuerpo = (s.cuerpo ?? '').trim()
      const espec = SECCIONES_RELATO.find(e => e.clave === s.clave)!
      return {
        dossier_id: dossierId, client_id: session.client_id, clave: s.clave,
        titulo: espec.etiqueta, cuerpo, orden: espec.orden,
        visible: cuerpo.length > 0,
        // Marca si este texto nació de un borrador de IA. `ia_uso` cuenta llamadas;
        // esto responde otra pregunta: si la IA acabó de verdad en el documento.
        generado_ia: !!s.generado_ia && cuerpo.length > 0,
        updated_at: new Date().toISOString(),
      }
    })

  if (filas.length) {
    const { error } = await db.from('dossier_secciones').upsert(filas, { onConflict: 'dossier_id,clave' })
    if (error) return { ok: false, error: 'No se pudo guardar el relato.' }
  }

  revalidatePath('/portal/dossier')
  return { ok: true }
}

// Plantilla y puestos desde RRHH para precargar la sección Equipo. Llenado rápido
// ADITIVO: devuelve texto sugerido; el dueño lo edita o lo ignora. Sin rrhh → null,
// y Equipo sigue siendo texto libre (la independencia va en las dos direcciones).
export async function sugerirEquipoDesdeRrhh(): Promise<string | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const modulos = await modulosDelCliente(db, session.client_id)
  if (!tieneModulo(modulos, 'rrhh')) return null

  const { data } = await db.from('empleados')
    .select('nombre, cargo, fecha_baja')
    .eq('client_id', session.client_id)
    .is('fecha_baja', null)
    .order('cargo')
  if (!data || data.length === 0) return null

  // Agrupa por cargo: "3 Cocineros · 2 Camareros" lee mejor que 17 nombres sueltos.
  const porCargo = new Map<string, string[]>()
  for (const e of data as { nombre: string; cargo: string | null }[]) {
    const cargo = (e.cargo || 'Sin puesto').trim()
    const lista = porCargo.get(cargo) ?? []
    lista.push(e.nombre)
    porCargo.set(cargo, lista)
  }

  const partes = [...porCargo.entries()].map(([cargo, nombres]) =>
    nombres.length === 1 ? `${cargo}: ${nombres[0]}` : `${cargo} (${nombres.length})`)

  return `Somos un equipo de ${data.length} ${data.length === 1 ? 'persona' : 'personas'}: ${partes.join(' · ')}.`
}

// ── Marca (color y logo PROPIOS del dossier, no del negocio) ───────────────────

// El color se normaliza y se guarda tal cual lo elige el dueño; la paleta legible
// se DERIVA al pintar (derivarPaleta), nunca se congela en la fila: si mañana
// afinamos el algoritmo de contraste, los dossiers ya guardados mejoran solos.
export async function guardarMarca(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const color = normalizarHex((formData.get('color_principal') as string) || '')

  const db = createAdminClient()
  const { error } = await db.from('dossiers')
    .update({ color_principal: color, updated_at: new Date().toISOString() })
    .eq('dossier_id', dossierId).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo guardar el color.' }

  revalidatePath('/portal/dossier')
  return { ok: true }
}

// Ruta del logo propio del dossier dentro del bucket compartido `logos`. El
// prefijo lo aísla del logo de empresa (<client_id>/<empresa_id>.<ext>): mismo
// bucket, nunca el mismo fichero.
const rutaLogo = (clientId: string, dossierId: string) => `${clientId}/dossier-${dossierId}.webp`

// Sube el logo propio del dossier. Mismo pipeline que el catálogo: comprimido en
// cliente + re-optimizado aquí con sharp.
export async function subirLogoDossier(formData: FormData): Promise<{ ok: boolean; error?: string; logo_url?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  const file = formData.get('logo') as File | null
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }
  if (!file || file.size === 0) return { ok: false, error: 'No se recibió archivo.' }
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: 'La imagen no puede superar 8 MB.' }
  if (!file.type.startsWith('image/')) return { ok: false, error: 'El archivo debe ser una imagen.' }

  const db = createAdminClient()
  const { data: dos } = await db.from('dossiers').select('dossier_id')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { ok: false, error: 'Dossier no encontrado.' }

  // La miniatura de 400px basta y sobra para un logo: no subimos el full.
  let thumb: Buffer
  try {
    const opt = await optimizarImagen(Buffer.from(await file.arrayBuffer()))
    thumb = opt.thumb
  } catch (e) {
    return { ok: false, error: `No se pudo procesar la imagen: ${(e as Error).message}` }
  }

  // Blob, NUNCA Buffer: en el serverless de Vercel el Buffer se recodifica a
  // UTF-8 y la imagen llega corrupta al bucket (gotcha confirmado en catalogo).
  const path = rutaLogo(session.client_id, dossierId)
  const up = await db.storage.from('logos')
    .upload(path, new Blob([new Uint8Array(thumb)], { type: 'image/webp' }), { contentType: 'image/webp', upsert: true })
  if (up.error) return { ok: false, error: up.error.message }

  const { data: { publicUrl } } = db.storage.from('logos').getPublicUrl(path)
  const logo_url = `${publicUrl}?v=${Date.now()}`   // upsert reusa el path: rompe la caché

  const { error } = await db.from('dossiers')
    .update({ logo_url, updated_at: new Date().toISOString() })
    .eq('dossier_id', dossierId).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo guardar el logo.' }

  revalidatePath('/portal/dossier')
  return { ok: true, logo_url }
}

// Copia el logo de la empresa al dossier (llenado rápido aditivo: el dossier
// sigue siendo autocontenido; se queda con la URL, no con una dependencia).
export async function usarLogoEmpresa(formData: FormData): Promise<{ ok: boolean; error?: string; logo_url?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  const { data: dos } = await db.from('dossiers').select('empresa_id')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { ok: false, error: 'Dossier no encontrado.' }

  const logo_url = await logoDeEmpresa(dos.empresa_id ?? null)
  if (!logo_url) return { ok: false, error: 'Tu empresa no tiene logo configurado.' }

  const { error } = await db.from('dossiers')
    .update({ logo_url, updated_at: new Date().toISOString() })
    .eq('dossier_id', dossierId).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo copiar el logo.' }

  revalidatePath('/portal/dossier')
  return { ok: true, logo_url }
}

export async function quitarLogoDossier(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  // Borra SOLO el fichero propio del dossier. Comparte bucket con el logo de la
  // empresa, pero nunca su path: si el logo venía copiado de la empresa, este
  // remove es un no-op y la empresa jamás se queda sin logo por limpiar un dossier.
  await db.storage.from('logos').remove([rutaLogo(session.client_id, dossierId)])

  const { error } = await db.from('dossiers')
    .update({ logo_url: null, updated_at: new Date().toISOString() })
    .eq('dossier_id', dossierId).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo quitar el logo.' }

  revalidatePath('/portal/dossier')
  return { ok: true }
}

// ── Publicación del deck ───────────────────────────────────────────────────────

// El token es una CAPABILITY URL: quien lo tiene, ve el deck. No hay login que
// poner delante (el inversor no es usuario de CLAUX), así que la mitigación real
// no es esconderlo, es poder REVOCARLO.
const nuevoToken = () => crypto.randomUUID().replace(/-/g, '')

export async function publicarDossier(formData: FormData): Promise<{ ok: boolean; error?: string; token?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  const { data: dos } = await db.from('dossiers').select('token, snapshot_at')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { ok: false, error: 'Dossier no encontrado.' }
  // Publicar un deck sin números es enseñar un gráfico vacío a un inversor.
  if (!dos.snapshot_at) return { ok: false, error: 'Carga tus números antes de publicar.' }

  const token = (dos.token as string | null) ?? nuevoToken()
  const { error } = await db.from('dossiers').update({
    estado: 'PUBLICADO', token, publicado_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('dossier_id', dossierId).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo publicar.' }

  revalidatePath('/portal/dossier')
  revalidatePath(`/d/${token}`)
  return { ok: true, token }
}

// Despublicar conserva el token: si vuelve a publicar, el enlace que ya repartió
// sigue sirviendo. Para invalidarlo de verdad está `revocarEnlace`.
export async function despublicarDossier(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  const { data: dos } = await db.from('dossiers').select('token')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { ok: false, error: 'Dossier no encontrado.' }

  const { error } = await db.from('dossiers')
    .update({ estado: 'BORRADOR', updated_at: new Date().toISOString() })
    .eq('dossier_id', dossierId).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo despublicar.' }

  revalidatePath('/portal/dossier')
  if (dos.token) revalidatePath(`/d/${dos.token}`)
  return { ok: true }
}

// Revocar = token nuevo. El enlace repartido deja de existir (404) y el dossier
// sigue publicado bajo otra URL.
export async function revocarEnlace(formData: FormData): Promise<{ ok: boolean; error?: string; token?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  const { data: dos } = await db.from('dossiers').select('token')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { ok: false, error: 'Dossier no encontrado.' }

  const token = nuevoToken()
  const { error } = await db.from('dossiers')
    .update({ token, updated_at: new Date().toISOString() })
    .eq('dossier_id', dossierId).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo revocar el enlace.' }

  revalidatePath('/portal/dossier')
  if (dos.token) revalidatePath(`/d/${dos.token}`)   // el viejo pasa a 404
  revalidatePath(`/d/${token}`)
  return { ok: true, token }
}

// ── Lectura pública del deck (sin sesión, solo por token) ──────────────────────

export interface DeckPublico {
  nombre: string
  logoUrl: string | null
  color: string
  moneda: string
  periodoDesde: string | null
  periodoHasta: string | null
  snapshotAt: string | null
  crecimientoPct: number
  secciones: SeccionRelato[]
  serie: FilaSerie[]
  lineas: LineaDesglose[]
  tasas: Record<string, TasaUsada>
  faltantes: string[]
}

/**
 * Deck por token. Solo PUBLICADO: despublicar o revocar → null → 404 en la
 * siguiente petición. Sin sesión a propósito (el inversor no es usuario), y sin
 * `client_id` en la respuesta: la URL no debe filtrar quién es el negocio más
 * allá de lo que el propio dueño pone en la portada.
 */
export async function obtenerDeckPublico(token: string): Promise<DeckPublico | null> {
  const limpio = (token ?? '').trim()
  if (!/^[0-9a-f]{32}$/.test(limpio)) return null   // forma del token: nada de escanear

  const db = createAdminClient()
  const { data: dos } = await db.from('dossiers').select('*')
    .eq('token', limpio).eq('estado', 'PUBLICADO').maybeSingle()
  if (!dos) return null

  const [{ data: serieRows }, { data: lineaRows }, { data: seccionRows }, { data: cliente }] = await Promise.all([
    db.from('dossier_serie').select('mes, ingresos, costo_ventas, gastos_operativos, moneda, origen')
      .eq('dossier_id', dos.dossier_id).order('mes'),
    db.from('dossier_lineas').select('grupo, concepto, monto, orden')
      .eq('dossier_id', dos.dossier_id).order('orden'),
    db.from('dossier_secciones').select('clave, cuerpo, generado_ia')
      .eq('dossier_id', dos.dossier_id).eq('visible', true).order('orden'),
    db.from('clients').select('nombre_empresa').eq('client_id', dos.client_id).maybeSingle(),
  ])

  // Nombre de la portada: el de la empresa del dossier; si es consolidado, el del
  // negocio. `titulo` NO: es interno ("solo lo ves tú").
  let nombre = (cliente?.nombre_empresa as string) || 'Mi negocio'
  if (dos.empresa_id) {
    const { data: emp } = await db.from('empresas').select('nombre')
      .eq('empresa_id', dos.empresa_id).eq('client_id', dos.client_id).maybeSingle()
    if (emp?.nombre) nombre = emp.nombre as string
  }

  return {
    nombre,
    logoUrl: dos.logo_url ?? null,
    color: dos.color_principal || '#00AFAA',
    moneda: dos.moneda_presentacion,
    periodoDesde: dos.periodo_desde ?? null,
    periodoHasta: dos.periodo_hasta ?? null,
    snapshotAt: dos.snapshot_at ?? null,
    crecimientoPct: Number(dos.crecimiento_mensual_pct) || 0,
    secciones: (seccionRows ?? []).map((r: Record<string, unknown>) => ({
      clave: r.clave as string, cuerpo: (r.cuerpo as string) ?? '', generado_ia: !!r.generado_ia,
    })),
    serie: (serieRows ?? []).map((r: Record<string, unknown>) => ({
      mes: r.mes as string,
      ingresos: Number(r.ingresos), costo_ventas: Number(r.costo_ventas), gastos_operativos: Number(r.gastos_operativos),
      moneda: r.moneda as string, origen: (r.origen === 'BASE' ? 'BASE' : 'MANUAL'),
    })),
    lineas: (lineaRows ?? []).map((r: Record<string, unknown>) => ({
      grupo: r.grupo as LineaDesglose['grupo'], concepto: r.concepto as string, monto: Number(r.monto), orden: Number(r.orden),
    })),
    tasas: (dos.tasas_usadas && typeof dos.tasas_usadas === 'object') ? dos.tasas_usadas as Record<string, TasaUsada> : {},
    faltantes: Array.isArray(dos.monedas_faltantes) ? dos.monedas_faltantes : [],
  }
}

// Previsualiza "actualizar desde mis datos" SIN escribir nada (requiere base).
export async function previsualizarActualizacion(dossierId: string): Promise<PreviewActualizacion | { error: string }> {
  const session = await getPortalSession()
  if (!session) return { error: 'Sesión inválida.' }

  const db = createAdminClient()
  const modulos = await modulosDelCliente(db, session.client_id)
  if (!tieneModulo(modulos, 'base')) return { error: 'Necesitas la Contabilidad para traer tus números.' }

  const { data: dos } = await db.from('dossiers')
    .select('empresa_id, moneda_presentacion, periodo_desde, periodo_hasta')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { error: 'Dossier no encontrado.' }

  const fallback = periodo12()
  const [{ data: serieRows }, empresaIds, costoMap] = await Promise.all([
    db.from('dossier_serie').select('mes, ingresos, costo_ventas, gastos_operativos, moneda, origen')
      .eq('dossier_id', dossierId).eq('client_id', session.client_id),
    empresaIdsDe(dos.empresa_id ?? null),
    clasificacionCosto(db, session.client_id),
  ])

  const actual: FilaSerie[] = (serieRows ?? []).map((r: Record<string, unknown>) => ({
    mes: r.mes as string, ingresos: Number(r.ingresos), costo_ventas: Number(r.costo_ventas),
    gastos_operativos: Number(r.gastos_operativos), moneda: r.moneda as string,
    origen: r.origen === 'BASE' ? 'BASE' : 'MANUAL',
  }))

  const snap = await construirSnapshotDesdeBase(
    db, session.client_id, empresaIds,
    dos.periodo_desde ?? fallback.desde, dos.periodo_hasta ?? fallback.hasta,
    dos.moneda_presentacion, costoMap,
  )

  const plan = fusionarSerie(actual, snap.serie)
  return { ...plan, monedasFaltantes: snap.monedasFaltantes }
}

// Aplica la actualización: resuelve la fusión con las decisiones del dueño y
// escribe serie + líneas + tasas + faltantes vía la RPC.
export async function aplicarActualizacion(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  const modulos = await modulosDelCliente(db, session.client_id)
  if (!tieneModulo(modulos, 'base')) return { ok: false, error: 'Necesitas la Contabilidad para traer tus números.' }

  const { data: dos } = await db.from('dossiers')
    .select('empresa_id, moneda_presentacion, periodo_desde, periodo_hasta')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { ok: false, error: 'Dossier no encontrado.' }

  let aceptados: string[] = []
  try { aceptados = JSON.parse((formData.get('conflictos_aceptados') as string) || '[]') } catch { aceptados = [] }

  const fallback = periodo12()
  const [{ data: serieRows }, empresaIds, costoMap] = await Promise.all([
    db.from('dossier_serie').select('mes, ingresos, costo_ventas, gastos_operativos, moneda, origen')
      .eq('dossier_id', dossierId).eq('client_id', session.client_id),
    empresaIdsDe(dos.empresa_id ?? null),
    clasificacionCosto(db, session.client_id),
  ])

  const actual: FilaSerie[] = (serieRows ?? []).map((r: Record<string, unknown>) => ({
    mes: r.mes as string, ingresos: Number(r.ingresos), costo_ventas: Number(r.costo_ventas),
    gastos_operativos: Number(r.gastos_operativos), moneda: r.moneda as string,
    origen: r.origen === 'BASE' ? 'BASE' : 'MANUAL',
  }))

  const snap = await construirSnapshotDesdeBase(
    db, session.client_id, empresaIds,
    dos.periodo_desde ?? fallback.desde, dos.periodo_hasta ?? fallback.hasta,
    dos.moneda_presentacion, costoMap,
  )

  const serieFinal = resolverFusion(actual, snap.serie, aceptados)
  const res = await escribirSnapshot(db, dossierId, session.client_id, serieFinal, snap.lineas, snap.tasasUsadas, snap.monedasFaltantes)
  if (!res.ok) return res

  revalidatePath('/portal/dossier')
  return { ok: true }
}
