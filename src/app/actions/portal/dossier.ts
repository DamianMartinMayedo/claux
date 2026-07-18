'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { tieneModulo } from '@/lib/modulos'
import { hoyEnTz } from '@/lib/fecha-tz'
import { optimizarImagen } from '@/lib/imagen/optimizar'
import { getPortalSession, puedeEditarModulo } from './auth'
import { obtenerEmpresas } from './empresas'
import { construirSnapshotDesdeBase, type LineaDesglose } from '@/lib/dossier/base'
import { construirConversor } from '@/lib/tasas'
import { fusionarSerie, resolverFusion, type FilaSerie, type PlanFusion } from '@/lib/dossier/snapshot'
import { SECCIONES_RELATO } from '@/lib/dossier/secciones'
import { normalizarHex } from '@/lib/dossier/paleta'

// ── Funcionalidad "Dossier del negocio" (clave `dossier`) ──
// Independiente: funciona a mano sin la base. Con `base`, puede TRAER los números
// (llenado rápido) con fusión NO destructiva. Todo scoped por `client_id`.
//
// VARIOS dossiers por cliente los desbloquea el addon `multidossier`. Sin él:
// un dossier y un enlace publicado. Los gates son de aplicación (bloqueoCrear /
// bloqueoPublicar), no de esquema — la base soporta N desde la 098.

export interface TasaUsada { tasa: number; fecha: string | null }

export interface DossierBasico {
  dossier_id:              string
  titulo:                  string
  estado:                  'BORRADOR' | 'PUBLICADO'
  empresa_id:              string | null
  nombre_portada:          string | null   // nombre público elegido; vacío → se deriva
  contacto_email:          string | null   // correo de contacto para la portada de cierre
  moneda_presentacion:     string
  color_principal:         string
  logo_url:                string | null
  periodo_desde:           string | null
  periodo_hasta:           string | null
  crecimiento_mensual_pct: number
  snapshot_at:             string | null
  // moneda/empresa/período definen el snapshot; si cambian tras congelar, la serie
  // queda desfasada (importes en la moneda vieja, o de otra empresa) hasta reescribirla.
  snapshot_stale:          boolean
  token:                   string | null
  monedas_faltantes:       string[]
  tasas_usadas:            Record<string, TasaUsada>
}

// Cabecera para el listado (addon `multidossier`): lo justo para decidir cuál
// abrir y cuál está listo para enviar. Sin serie ni relato — una fila de tabla no
// necesita el snapshot entero, y son N dossiers.
export interface ResumenDossier {
  dossier_id:          string
  titulo:              string
  estado:              'BORRADOR' | 'PUBLICADO'
  empresa_id:          string | null
  moneda_presentacion: string
  periodo_desde:       string | null
  periodo_hasta:       string | null
  snapshot_at:         string | null
  snapshot_stale:      boolean
  token:               string | null
  updated_at:          string
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
  nombreNegocio:      string                  // nombre de la cuenta: defecto de portada en consolidado
  emailUsuario:       string                  // correo de registro: precarga del contacto del dossier
  primerMovimiento:   string | null           // fecha del 1er dato contable → atajo "Toda la vida"
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

// ── Gates del addon `multidossier` ──
// Van en el servidor y no en el botón: estas actions son públicas y ocultar la UI
// no es control de acceso (MODELO-MODULOS §3.2). Devuelven el mensaje de error, o
// null si puede seguir; el mensaje ES el upsell —aparece justo cuando el dueño
// quiere la capacidad—, así que no hacen falta candados en el portal.

// Duplicar ES crear, así que las dos actions comparten este gate.
async function bloqueoCrear(db: Db, clientId: string): Promise<string | null> {
  if (tieneModulo(await modulosDelCliente(db, clientId), 'multidossier')) return null
  const { count } = await db.from('dossiers')
    .select('dossier_id', { count: 'exact', head: true }).eq('client_id', clientId)
  return (count ?? 0) >= 1
    ? 'Tu suscripción permite un solo dossier. Activa Multidossier para tener varios.'
    : null
}

// El enlace ES el producto, así que este es el gate con dientes: sin él, alguien
// contrata un mes, publica cinco enlaces y se da de baja con los cinco vivos. No
// destruye nada —los dossiers se siguen viendo y editando, regla de independencia—,
// solo impide un segundo enlace publicado a la vez.
async function bloqueoPublicar(db: Db, clientId: string, dossierId: string): Promise<string | null> {
  if (tieneModulo(await modulosDelCliente(db, clientId), 'multidossier')) return null
  const { count } = await db.from('dossiers').select('dossier_id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('estado', 'PUBLICADO').neq('dossier_id', dossierId)
  return (count ?? 0) >= 1
    ? 'Ya tienes una presentación publicada. Despublícala, o activa Multidossier para tener varias a la vez.'
    : null
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

// El deck es caché de por vida (revalidate = false) y solo se rebusca por evento.
// Cualquier cambio a un dossier PUBLICADO (números, relato, marca) tiene que
// invalidar su ruta pública, o el enlace en vivo se queda con lo de antes.
async function revalidarDeck(db: Db, dossierId: string, clientId: string): Promise<void> {
  const { data } = await db.from('dossiers').select('token, estado')
    .eq('dossier_id', dossierId).eq('client_id', clientId).maybeSingle()
  if (data?.estado === 'PUBLICADO' && data.token) revalidatePath(`/d/${data.token}`)
}

// ── Lectura ─────────────────────────────────────────────────────────────────────

// Cabeceras de todos los dossiers, para el listado del addon. Una sola query.
export async function obtenerDossiers(): Promise<ResumenDossier[]> {
  const session = await getPortalSession()
  if (!session) return []

  const db = createAdminClient()
  const { data } = await db.from('dossiers')
    .select('dossier_id, titulo, estado, empresa_id, moneda_presentacion, periodo_desde, periodo_hasta, snapshot_at, snapshot_stale, token, updated_at')
    .eq('client_id', session.client_id)
    .order('created_at', { ascending: true })

  return (data ?? []).map((r: Record<string, unknown>) => ({
    dossier_id: r.dossier_id as string,
    titulo: r.titulo as string,
    estado: (r.estado === 'PUBLICADO' ? 'PUBLICADO' : 'BORRADOR') as ResumenDossier['estado'],
    empresa_id: (r.empresa_id as string) ?? null,
    moneda_presentacion: r.moneda_presentacion as string,
    periodo_desde: (r.periodo_desde as string) ?? null,
    periodo_hasta: (r.periodo_hasta as string) ?? null,
    snapshot_at: (r.snapshot_at as string) ?? null,
    // Ojo: aquí NO se comprueba la mezcla de monedas de la serie (el OR que sí hace
    // obtenerDossier). Eso costaría una query por fila y el listado solo pinta un
    // badge; el desfase real lo vuelve a mirar el editor, y publicar lo verifica
    // contra la base. Un listado que se queda corto avisando es aceptable; uno que
    // hace N+1 queries, no.
    snapshot_stale: !!r.snapshot_stale,
    token: (r.token as string) ?? null,
    updated_at: r.updated_at as string,
  }))
}

// Sin `id` devuelve el más antiguo: es el camino sin addon, y se comporta
// exactamente igual que antes de que existiera multidossier.
export async function obtenerDossier(id?: string): Promise<DossierData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const base = db.from('dossiers').select('*').eq('client_id', session.client_id)
  const [modulos, empresas, { data: monedasRows }, { data: dosRow }, { data: clienteRow }] = await Promise.all([
    modulosDelCliente(db, session.client_id),
    obtenerEmpresas(),
    // `activa`: mismo criterio que el aviso de setup del dashboard — una moneda
    // dada de baja no es una opción de presentación.
    db.from('monedas').select('codigo, simbolo, es_consolidacion').eq('client_id', session.client_id).eq('activa', true),
    (id ? base.eq('dossier_id', id) : base.order('created_at', { ascending: true }).limit(1)).maybeSingle(),
    db.from('clients').select('nombre_empresa').eq('client_id', session.client_id).maybeSingle(),
  ])
  const nombreNegocio = (clienteRow?.nombre_empresa as string) || 'Mi negocio'

  const tieneBase    = tieneModulo(modulos, 'base')
  const tieneRrhh    = tieneModulo(modulos, 'rrhh')
  const multiempresa = tieneModulo(modulos, 'multiempresa')
  const monedas = (monedasRows ?? []).map((m: { codigo: string; simbolo: string | null }) => ({ codigo: m.codigo, simbolo: m.simbolo || m.codigo }))
  const monedaConsolidacion = (monedasRows ?? []).find((m: { es_consolidacion: boolean }) => m.es_consolidacion)?.codigo ?? null

  const categoriasCosto = tieneBase ? await obtenerCategoriasGasto() : []
  const listaEmpresas = empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre }))

  // Fecha del primer movimiento contable (para el atajo de período "Toda la vida").
  // Solo con base: sin ella no hay serie de dónde sacar un "desde el principio".
  let primerMovimiento: string | null = null
  if (tieneBase) {
    const [{ data: fMin }, { data: gMin }] = await Promise.all([
      db.from('facturas').select('fecha_emision').eq('client_id', session.client_id).order('fecha_emision', { ascending: true }).limit(1).maybeSingle(),
      db.from('gastos_cobros').select('fecha').eq('client_id', session.client_id).order('fecha', { ascending: true }).limit(1).maybeSingle(),
    ])
    const fechas = [fMin?.fecha_emision, gMin?.fecha].filter(Boolean) as string[]
    if (fechas.length) primerMovimiento = fechas.sort()[0]
  }

  if (!dosRow) {
    return {
      dossier: null, serie: [], lineas: [], secciones: [],
      tieneBase, tieneRrhh, multiempresa, nombreNegocio, emailUsuario: session.email, primerMovimiento, empresas: listaEmpresas,
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
    nombre_portada: dosRow.nombre_portada ?? null,
    contacto_email: dosRow.contacto_email ?? null,
    moneda_presentacion: dosRow.moneda_presentacion,
    color_principal: dosRow.color_principal,
    logo_url: dosRow.logo_url ?? null,
    periodo_desde: dosRow.periodo_desde ?? null,
    periodo_hasta: dosRow.periodo_hasta ?? null,
    crecimiento_mensual_pct: Number(dosRow.crecimiento_mensual_pct) || 0,
    snapshot_at: dosRow.snapshot_at ?? null,
    // Desfasado si lo marcó guardarBasicos (cambio de parámetro) O si la serie no
    // está toda en la moneda de presentación (mezcla heredada de fusiones previas):
    // en ambos casos hay que re-sincronizar antes de enseñarla.
    snapshot_stale: !!dosRow.snapshot_stale || serie.some(f => f.moneda !== dosRow.moneda_presentacion),
    token: dosRow.token ?? null,
    monedas_faltantes: Array.isArray(dosRow.monedas_faltantes) ? dosRow.monedas_faltantes : [],
    tasas_usadas: (dosRow.tasas_usadas && typeof dosRow.tasas_usadas === 'object') ? dosRow.tasas_usadas as Record<string, TasaUsada> : {},
  }

  return {
    dossier, serie, lineas, secciones,
    tieneBase, tieneRrhh, multiempresa, nombreNegocio, emailUsuario: session.email, primerMovimiento, empresas: listaEmpresas,
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
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const bloqueo = await bloqueoCrear(db, session.client_id)
  if (bloqueo) return { ok: false, error: bloqueo }

  // Prerrequisito raíz: sin ninguna empresa no hay negocio del que sacar números
  // (el consolidado sobre cero empresas está vacío). Va en el servidor, no solo en
  // el banner: ocultar la UI no es control de acceso. Tener moneda pero ninguna
  // empresa NO habilita crear.
  // Se cuenta con obtenerEmpresas(), la MISMA fuente que llena data.empresas y
  // decide el banner del wizard: una consulta propia aquí puede divergir de lo
  // que ve el usuario (esta contaba `companies`, que ni siquiera es la tabla de
  // empresas, así que bloqueaba a todo el mundo).
  const empresas = await obtenerEmpresas()
  if (!empresas.length) return { ok: false, error: 'Necesitas crear al menos una empresa antes de crear un dossier.' }

  const titulo   = (formData.get('titulo') as string)?.trim() || 'Dossier para inversores'
  const empresaId = (formData.get('empresa_id') as string)?.trim() || null
  const moneda   = (formData.get('moneda_presentacion') as string)?.trim()
  if (!moneda) return { ok: false, error: 'Falta la moneda de presentación.' }
  const contactoEmail = ((formData.get('contacto_email') as string) ?? '').trim() || null
  if (contactoEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactoEmail)) {
    return { ok: false, error: 'El correo de contacto no parece válido.' }
  }

  const fallback = periodo12()
  const desde = (formData.get('periodo_desde') as string)?.trim() || fallback.desde
  const hasta = (formData.get('periodo_hasta') as string)?.trim() || fallback.hasta

  const dossier_id = genId('DOS')
  const { error } = await db.from('dossiers').insert({
    dossier_id, client_id: session.client_id,
    empresa_id: empresaId, titulo, estado: 'BORRADOR', contacto_email: contactoEmail,
    moneda_presentacion: moneda, periodo_desde: desde, periodo_hasta: hasta,
  })
  if (error) return { ok: false, error: 'No se pudo crear el dossier.' }

  revalidatePath('/portal/dossier')
  return { ok: true, dossier_id }
}

// Duplicar: el atajo del addon. El caso real es "el mismo negocio contado a otro
// inversor" — los números ya están, lo que cambia es el relato. Volver a teclear
// doce meses para eso es justo la fricción por la que el addon no se renovaría.
export async function duplicarDossier(formData: FormData): Promise<{ ok: boolean; error?: string; dossier_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const origenId = (formData.get('dossier_id') as string)?.trim()
  if (!origenId) return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  const bloqueo = await bloqueoCrear(db, session.client_id)   // duplicar ES crear
  if (bloqueo) return { ok: false, error: bloqueo }

  const { data: origen } = await db.from('dossiers').select('*')
    .eq('dossier_id', origenId).eq('client_id', session.client_id).maybeSingle()
  if (!origen) return { ok: false, error: 'Dossier no encontrado.' }

  const dossier_id = genId('DOS')
  // Copia campo a campo, NUNCA {...origen}. Dos motivos, y el primero es la razón
  // de ser del addon:
  //  · `token` es unique: arrastrarlo revienta el insert. Y si algún día dejara de
  //    serlo sería peor —dos dossiers compartiendo el enlace en vivo, que es
  //    exactamente lo que este addon existe para evitar—. La copia nace en BORRADOR
  //    sin token y se gana el suyo al publicar; el enlace del original ni se entera.
  //  · Los NÚMEROS se heredan (snapshot_at, tasas_usadas: es el mismo negocio); la
  //    historia de publicación no (publicado_at, created_at).
  const { error } = await db.from('dossiers').insert({
    dossier_id, client_id: session.client_id,
    titulo: `${origen.titulo} (copia)`,
    estado: 'BORRADOR', token: null, publicado_at: null,
    empresa_id: origen.empresa_id,
    nombre_portada: origen.nombre_portada,
    contacto_email: origen.contacto_email,
    moneda_presentacion: origen.moneda_presentacion,
    color_principal: origen.color_principal,
    logo_url: origen.logo_url,
    periodo_desde: origen.periodo_desde,
    periodo_hasta: origen.periodo_hasta,
    crecimiento_mensual_pct: origen.crecimiento_mensual_pct,
    snapshot_at: origen.snapshot_at,
    snapshot_stale: origen.snapshot_stale,
    tasas_usadas: origen.tasas_usadas,
    monedas_faltantes: origen.monedas_faltantes,
  })
  if (error) return { ok: false, error: 'No se pudo duplicar el dossier.' }

  // Filas hijas. El `select` enumera columnas de NEGOCIO a propósito: las tres
  // tablas llevan además un `id` identity que no se ve en el modelo de dominio, y
  // un select('*') lo arrastraría al insert. En serie y secciones el unique lo
  // cazaría; en dossier_lineas, que no tiene unique, pasaría callando.
  // dossier_costo_ventas NO se copia: es de nivel client_id, ya se hereda.
  const [{ data: serie }, { data: lineas }, { data: secciones }] = await Promise.all([
    db.from('dossier_serie').select('mes, ingresos, costo_ventas, gastos_operativos, moneda, origen')
      .eq('dossier_id', origenId).eq('client_id', session.client_id),
    db.from('dossier_lineas').select('grupo, concepto, monto, orden')
      .eq('dossier_id', origenId).eq('client_id', session.client_id),
    db.from('dossier_secciones').select('clave, titulo, cuerpo, bullets, orden, visible, generado_ia')
      .eq('dossier_id', origenId).eq('client_id', session.client_id),
  ])

  const conDestino = <T extends object>(filas: T[] | null) =>
    (filas ?? []).map(f => ({ ...f, dossier_id, client_id: session.client_id }))

  const hijas = await Promise.all([
    serie?.length     ? db.from('dossier_serie').insert(conDestino(serie))         : null,
    lineas?.length    ? db.from('dossier_lineas').insert(conDestino(lineas))       : null,
    secciones?.length ? db.from('dossier_secciones').insert(conDestino(secciones)) : null,
  ])
  // Si alguna hija falla, la copia queda a medias (sin transacción entre tablas):
  // mejor no dejarla suelta en la lista con la mitad de los números del original.
  if (hijas.some(r => r?.error)) {
    await eliminarFilas(db, dossier_id, session.client_id)
    return { ok: false, error: 'No se pudo duplicar el dossier.' }
  }

  revalidatePath('/portal/dossier')
  return { ok: true, dossier_id }
}

// Borra las filas de un dossier (hijas primero). Sin FKs declaradas no hay cascade:
// el orden lo lleva el código, y las huérfanas no las limpiaría nadie.
async function eliminarFilas(db: Db, dossierId: string, clientId: string): Promise<void> {
  for (const t of ['dossier_serie', 'dossier_lineas', 'dossier_secciones'] as const) {
    await db.from(t).delete().eq('dossier_id', dossierId).eq('client_id', clientId)
  }
  await db.from('dossiers').delete().eq('dossier_id', dossierId).eq('client_id', clientId)
}

export async function eliminarDossier(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  const { data: dos } = await db.from('dossiers').select('token, estado')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { ok: false, error: 'Dossier no encontrado.' }

  await eliminarFilas(db, dossierId, session.client_id)

  revalidatePath('/portal/dossier')
  // El deck es caché de por vida: sin esto, el enlace repartido seguiría sirviendo
  // un dossier que ya no existe.
  if (dos.token) revalidatePath(`/d/${dos.token}`)
  return { ok: true }
}

// Actualiza lo básico (título, empresa, período, moneda, crecimiento).
export async function guardarBasicos(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  // Estado actual: moneda/empresa/período son los PARÁMETROS del snapshot; si el
  // dueño cambia cualquiera, la serie congelada deja de corresponder (importes en
  // la moneda vieja, o de otra empresa). Lo comparamos para marcar el desfase.
  const { data: prev } = await db.from('dossiers')
    .select('empresa_id, moneda_presentacion, periodo_desde, periodo_hasta, snapshot_at')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!prev) return { ok: false, error: 'Dossier no encontrado.' }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const set = (k: string, v: unknown) => { if (v !== null && v !== undefined && v !== '') patch[k] = v }
  set('titulo', (formData.get('titulo') as string)?.trim())
  set('moneda_presentacion', (formData.get('moneda_presentacion') as string)?.trim())
  set('periodo_desde', (formData.get('periodo_desde') as string)?.trim())
  set('periodo_hasta', (formData.get('periodo_hasta') as string)?.trim())
  if (formData.has('empresa_id')) patch.empresa_id = (formData.get('empresa_id') as string)?.trim() || null
  if (formData.has('crecimiento_mensual_pct')) patch.crecimiento_mensual_pct = Number(formData.get('crecimiento_mensual_pct')) || 0
  // Correo de contacto: se puede fijar o VACIAR (por eso no usa `set`, que ignora
  // el vacío). Vacío → null (el deck no lo enseña).
  if (formData.has('contacto_email')) {
    const email = ((formData.get('contacto_email') as string) ?? '').trim()
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'El correo de contacto no parece válido.' }
    patch.contacto_email = email || null
  }

  // ¿Cambió algún parámetro del snapshot frente a lo guardado? Solo tiene sentido
  // si ya hay números congelados (si no, no hay nada que desfasar). El flag se
  // limpia solo al reescribir el snapshot (RPC dossier_guardar_snapshot).
  const cambia = (k: 'moneda_presentacion' | 'periodo_desde' | 'periodo_hasta' | 'empresa_id') =>
    k in patch && (patch[k] ?? null) !== (prev[k] ?? null)
  if (prev.snapshot_at && (cambia('moneda_presentacion') || cambia('periodo_desde') || cambia('periodo_hasta') || cambia('empresa_id'))) {
    patch.snapshot_stale = true
  }

  const { error } = await db.from('dossiers').update(patch).eq('dossier_id', dossierId).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo guardar.' }

  revalidatePath('/portal/dossier')
  await revalidarDeck(db, dossierId, session.client_id)
  return { ok: true }
}

// Guarda la serie tecleada a mano (o el estado tras una fusión). La rejilla ES la
// fuente sin base: guardar aquí = actualizar el snapshot. Escribe vía la RPC.
export async function guardarSerie(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  await revalidarDeck(db, dossierId, session.client_id)
  return { ok: true }
}

// Guarda la clasificación coste de ventas (nivel cliente; el 2º dossier la hereda).
export async function guardarCostoVentas(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  await revalidarDeck(db, dossierId, session.client_id)
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

  // Una línea por persona, formato "Nombre — Puesto": es lo que el editor del
  // Equipo parsea a filas y el deck pinta en cuadrícula. El dueño quita las que no
  // quiera enseñar (el llenado es aditivo, no una lista definitiva).
  return (data as { nombre: string; cargo: string | null }[])
    .map(e => {
      const cargo = (e.cargo || '').trim()
      return cargo ? `${e.nombre} — ${cargo}` : e.nombre
    })
    .join('\n')
}

// ── Marca (color y logo PROPIOS del dossier, no del negocio) ───────────────────

// El color se normaliza y se guarda tal cual lo elige el dueño; la paleta legible
// se DERIVA al pintar (derivarPaleta), nunca se congela en la fila: si mañana
// afinamos el algoritmo de contraste, los dossiers ya guardados mejoran solos.
export async function guardarMarca(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const color = normalizarHex((formData.get('color_principal') as string) || '')
  // Nombre de portada: vacío → null (el deck lo deriva de la empresa/cuenta). Se
  // guarda junto al color porque ambos son la identidad PÚBLICA del dossier. El
  // correo de contacto vive en «Lo básico» (guardarBasicos), no aquí.
  const nombrePortada = (formData.get('nombre_portada') as string ?? '').trim() || null

  const db = createAdminClient()
  const { error } = await db.from('dossiers')
    .update({ color_principal: color, nombre_portada: nombrePortada, updated_at: new Date().toISOString() })
    .eq('dossier_id', dossierId).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo guardar el color.' }

  revalidatePath('/portal/dossier')
  await revalidarDeck(db, dossierId, session.client_id)
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
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  await revalidarDeck(db, dossierId, session.client_id)
  return { ok: true, logo_url }
}

// Copia el logo de la empresa al dossier (llenado rápido aditivo: el dossier
// sigue siendo autocontenido; se queda con la URL, no con una dependencia).
export async function usarLogoEmpresa(formData: FormData): Promise<{ ok: boolean; error?: string; logo_url?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  await revalidarDeck(db, dossierId, session.client_id)
  return { ok: true, logo_url }
}

export async function quitarLogoDossier(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  await revalidarDeck(db, dossierId, session.client_id)
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
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const dossierId = (formData.get('dossier_id') as string)?.trim()
  if (!dossierId) return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  const { data: dos } = await db.from('dossiers').select('token, snapshot_at, snapshot_stale, moneda_presentacion')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { ok: false, error: 'Dossier no encontrado.' }
  // Publicar un deck sin números es enseñar un gráfico vacío a un inversor.
  if (!dos.snapshot_at) return { ok: false, error: 'Carga tus números antes de publicar.' }
  // Publicar un snapshot desfasado enseñaría importes en la moneda vieja (o de otra
  // empresa) al inversor. Que lo sincronice primero en «Los números». También si la
  // serie quedó mezclada de monedas (fusiones previas): no es uniforme → desfasado.
  const { data: mezcla } = await db.from('dossier_serie').select('mes')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id)
    .neq('moneda', dos.moneda_presentacion).limit(1).maybeSingle()
  if (dos.snapshot_stale || mezcla) return { ok: false, error: 'Cambiaste la moneda, la empresa o el período: sincroniza tus números en «Los números» antes de publicar.' }

  const bloqueo = await bloqueoPublicar(db, session.client_id, dossierId)
  if (bloqueo) return { ok: false, error: bloqueo }

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
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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

// ── Acciones en lote (la lista del addon opera sobre varios a la vez) ──────────
//
// Cada acción ENVUELVE la individual en un bucle: construye el `FormData` que esta
// espera y hereda su validación, gating y efectos (borrado de hijas, revalidación
// del deck, gate del addon al duplicar). No se duplica su lógica. El candado de
// módulo va INLINE al principio de cada una —audit-gating lo exige visible, no tras
// un helper de otro archivo— aunque la individual lo vuelva a comprobar.

export interface ResultadoLote {
  hechas:   number
  omitidas: { etiqueta: string; motivo: string }[]
  errores:  { etiqueta: string; error: string }[]
  error?:   string   // fallo global (sesión / permiso)
}

const loteVacio = (error?: string): ResultadoLote => ({ hechas: 0, omitidas: [], errores: [], error })

// Título + estado de los dossiers del lote en UNA query: etiqueta legible para el
// resumen y estado para decidir elegibilidad, sin una consulta por fila.
async function cabecerasLote(
  db: Db, clientId: string, ids: string[],
): Promise<Map<string, { titulo: string; estado: string }>> {
  const { data } = await db.from('dossiers').select('dossier_id, titulo, estado')
    .eq('client_id', clientId).in('dossier_id', ids)
  return new Map((data ?? []).map((d: { dossier_id: string; titulo: string; estado: string }) =>
    [d.dossier_id, { titulo: d.titulo, estado: d.estado }]))
}

// Eliminar en lote: envuelve `eliminarDossier` (borra hijas + dossier y revalida el
// deck publicado). Cualquier fallo de la individual → errores con su título.
export async function eliminarDossiersEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session) return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('dossier'))) return loteVacio('No tienes permiso para editar en este módulo.')

  const db = createAdminClient()
  const meta = await cabecerasLote(db, session.client_id, ids)

  const res = loteVacio()
  for (const id of ids) {
    const etiqueta = meta.get(id)?.titulo ?? id
    const fd = new FormData()
    fd.set('dossier_id', id)
    const r = await eliminarDossier(fd)
    if (r.ok) res.hechas++
    else res.errores.push({ etiqueta, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/dossier')
  return res
}

// Despublicar en lote: solo tiene sentido sobre los PUBLICADO. Un borrador ya está
// despublicado → omitido con su motivo (no es un error, no hay nada que hacer).
export async function despublicarDossiersEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session) return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('dossier'))) return loteVacio('No tienes permiso para editar en este módulo.')

  const db = createAdminClient()
  const meta = await cabecerasLote(db, session.client_id, ids)

  const res = loteVacio()
  for (const id of ids) {
    const info = meta.get(id)
    const etiqueta = info?.titulo ?? id
    if (!info) { res.errores.push({ etiqueta, error: 'Dossier no encontrado.' }); continue }
    if (info.estado !== 'PUBLICADO') { res.omitidas.push({ etiqueta, motivo: 'no está publicado' }); continue }
    const fd = new FormData()
    fd.set('dossier_id', id)
    const r = await despublicarDossier(fd)
    if (r.ok) res.hechas++
    else res.errores.push({ etiqueta, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/dossier')
  return res
}

// Duplicar en lote: SECUENCIAL a propósito. Duplicar ES crear y el gate del addon
// cuenta los dossiers existentes; en paralelo todas leerían el mismo conteo y se
// saltarían el límite de golpe. La individual ya nace en BORRADOR con `token:null`.
// El tope de Multidossier no es un error sino el límite del plan → a omitidas (es el
// upsell), el resto de fallos → errores.
export async function duplicarDossiersEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session) return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('dossier'))) return loteVacio('No tienes permiso para editar en este módulo.')

  const db = createAdminClient()
  const meta = await cabecerasLote(db, session.client_id, ids)

  const res = loteVacio()
  for (const id of ids) {
    const etiqueta = meta.get(id)?.titulo ?? id
    const fd = new FormData()
    fd.set('dossier_id', id)
    const r = await duplicarDossier(fd)   // secuencial: el gate del addon no es atómico
    if (r.ok) { res.hechas++; continue }
    if (r.error?.includes('Multidossier')) res.omitidas.push({ etiqueta, motivo: 'límite: activa Multidossier' })
    else res.errores.push({ etiqueta, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/dossier')
  return res
}

// ── Lectura pública del deck (sin sesión, solo por token) ──────────────────────

export interface DeckPublico {
  nombre: string
  contactoEmail: string | null
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

  // Nombre de la portada: si el dueño lo fijó, manda ese (holding, nombre
  // comercial…). Si no, se DERIVA: el de la empresa del dossier; si es consolidado,
  // el del negocio. `titulo` NO: es interno ("solo lo ves tú").
  let nombre = (cliente?.nombre_empresa as string) || 'Mi negocio'
  if (dos.empresa_id) {
    const { data: emp } = await db.from('empresas').select('nombre')
      .eq('empresa_id', dos.empresa_id).eq('client_id', dos.client_id).maybeSingle()
    if (emp?.nombre) nombre = emp.nombre as string
  }
  const nombrePortada = (dos.nombre_portada as string | null)?.trim()
  if (nombrePortada) nombre = nombrePortada

  // Moneda del deck: la CONGELADA en la serie, no la `moneda_presentacion` en vivo.
  // Si el dueño cambió la moneda sin re-sincronizar, los importes siguen en la
  // moneda vieja; rotular con esa (y no con la nueva) mantiene el deck veraz. Al
  // sincronizar, la serie se reescribe en la nueva y el rótulo la sigue solo.
  const monedaDeck = (serieRows?.[0]?.moneda as string) || dos.moneda_presentacion

  return {
    nombre,
    contactoEmail: (dos.contacto_email as string | null)?.trim() || null,
    logoUrl: dos.logo_url ?? null,
    color: dos.color_principal || '#00AFAA',
    moneda: monedaDeck,
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
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  await revalidarDeck(db, dossierId, session.client_id)
  return { ok: true }
}

// Re-sincroniza un snapshot DESFASADO: reconstruye la serie ENTERA desde la base
// en la moneda/empresa/período actuales. A diferencia de `aplicarActualizacion`
// (fusión incremental que conserva lo tecleado a mano), esto REEMPLAZA todo: tras
// cambiar la moneda, conservar filas en la moneda vieja dejaría la serie mezclada
// (importes en dos monedas, etiqueta equivocada). Solo con base; sin ella el dueño
// revisa a mano en «Los números». El flag snapshot_stale lo limpia la RPC al escribir.
export async function resincronizarSnapshot(dossierId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('dossier'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!dossierId)           return { ok: false, error: 'Falta el dossier.' }

  const db = createAdminClient()
  const modulos = await modulosDelCliente(db, session.client_id)
  if (!tieneModulo(modulos, 'base')) return { ok: false, error: 'Necesitas la Contabilidad para actualizar tus números.' }

  const { data: dos } = await db.from('dossiers')
    .select('empresa_id, moneda_presentacion, periodo_desde, periodo_hasta')
    .eq('dossier_id', dossierId).eq('client_id', session.client_id).maybeSingle()
  if (!dos) return { ok: false, error: 'Dossier no encontrado.' }

  const moneda = dos.moneda_presentacion
  const fallback = periodo12()
  const [conversor, empresaIds, costoMap, { data: serieRows }] = await Promise.all([
    construirConversor(db, session.client_id),
    empresaIdsDe(dos.empresa_id ?? null),
    clasificacionCosto(db, session.client_id),
    db.from('dossier_serie').select('mes, ingresos, costo_ventas, gastos_operativos, moneda, origen')
      .eq('dossier_id', dossierId).eq('client_id', session.client_id),
  ])

  // Filas de la base, ya en la moneda nueva (origen BASE): mandan para sus meses.
  const snap = await construirSnapshotDesdeBase(
    db, session.client_id, empresaIds,
    dos.periodo_desde ?? fallback.desde, dos.periodo_hasta ?? fallback.hasta,
    moneda, costoMap,
  )

  const baseMeses = new Set(snap.serie.map(f => f.mes))
  const faltantes = new Set(snap.monedasFaltantes)
  const tasas: Record<string, unknown> = { ...snap.tasasUsadas }
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

  // Filas MANUAL de meses que la base NO conoce: se CONSERVAN, pero convertidas a
  // la moneda nueva por tasa (no se tiran ni se quedan en la moneda vieja — eso es
  // lo que dejaba la serie mezclada). Sin tasa hacia la nueva, no se pueden
  // presentar: se excluyen y se informan como faltantes (mismo criterio que la base).
  const manual: FilaSerie[] = []
  for (const r of (serieRows ?? []) as Record<string, unknown>[]) {
    if (r.origen !== 'MANUAL' || baseMeses.has(r.mes as string)) continue
    const rowMoneda = r.moneda as string
    const ing = Number(r.ingresos) || 0, cv = Number(r.costo_ventas) || 0, go = Number(r.gastos_operativos) || 0
    if (rowMoneda === moneda) {
      manual.push({ mes: r.mes as string, ingresos: ing, costo_ventas: cv, gastos_operativos: go, moneda, origen: 'MANUAL' })
      continue
    }
    const factor = conversor.convertir(1, rowMoneda, moneda)
    if (factor == null) { faltantes.add(rowMoneda); continue }
    manual.push({
      mes: r.mes as string,
      ingresos: round2(ing * factor), costo_ventas: round2(cv * factor), gastos_operativos: round2(go * factor),
      moneda, origen: 'MANUAL',
    })
    const d = conversor.detalle(moneda, rowMoneda)
    if (d) tasas[rowMoneda] = d
  }

  const serieFinal = [...snap.serie, ...manual].sort((a, b) => a.mes.localeCompare(b.mes))
  const res = await escribirSnapshot(db, dossierId, session.client_id, serieFinal, snap.lineas, tasas, [...faltantes].sort())
  if (!res.ok) return res

  revalidatePath('/portal/dossier')
  await revalidarDeck(db, dossierId, session.client_id)
  return { ok: true }
}
