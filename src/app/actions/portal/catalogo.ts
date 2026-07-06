'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'
import { optimizarImagen } from '@/lib/imagen/optimizar'
import { construirConversor } from '@/lib/tasas'
import { etiquetasDe, ETIQUETAS_DEFAULT, type EtiquetasSector } from '@/lib/sector'

// ── Funcionalidad "Catálogo digital QR" (clave `catalogo_qr`) ──
// Modelo propio e independiente de Inventario. Todo scoped por `client_id`.

export interface CatalogoCategoria {
  categoria_id: string
  client_id:    string
  nombre:       string
  orden:        number
  activa:       boolean
  descuento_pct: number   // descuento masivo del grupo (%); 0 = sin descuento
}

export interface CatalogoItem {
  item_id:        string
  client_id:      string
  categoria_id:   string | null
  nombre:         string
  descripcion:    string | null
  precio:         number | null
  moneda:         string | null
  foto_url:       string | null
  foto_path:      string | null
  foto_thumb_url: string | null
  ingredientes:   string | null
  alergenos:      string | null
  calorias:       number | null
  disponible:     boolean
  orden:          number
  activo:         boolean
  producto_id:    string | null
  descuento_pct:  number   // descuento propio del ítem (%); manda sobre el del grupo
  // Campos calculados (no en BD):
  precioMostrado?: number | null   // precio FINAL (con descuento) convertido a la moneda del catálogo
  monedaMostrada?: string | null
  precioAntes?:    number | null   // precio original convertido, solo si hay descuento
  descuentoPct?:   number          // descuento efectivo aplicado (%)
  stock?:          number | null   // stock del producto vinculado (solo portal; nunca público)
}

export interface MonedaOpcion { codigo: string; simbolo: string }

// ── Helpers ────────────────────────────────────────────────────────────────────

function genId(prefijo: string): string {
  return `${prefijo}-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

function normalizarSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

async function etiquetasDeSector(db: ReturnType<typeof createAdminClient>, sector: string | null): Promise<EtiquetasSector> {
  if (!sector) return { ...ETIQUETAS_DEFAULT }
  const { data: pl } = await db.from('plantillas_sector').select('etiquetas').eq('sector', sector).maybeSingle()
  return etiquetasDe(pl?.etiquetas)
}

// La página pública se sirve con ISR (revalidate corto, ver page.tsx) para
// priorizar CDN/offline sobre frescura instantánea (CONTEXTO §3). Al editar el
// catálogo, refrescamos también su ruta pública (best-effort: sin slug no hay
// página pública que invalidar).
async function revalidarPublico(db: ReturnType<typeof createAdminClient>, client_id: string): Promise<void> {
  const { data } = await db.from('clients').select('slug').eq('client_id', client_id).maybeSingle()
  if (data?.slug) revalidatePath(`/${data.slug}/catalogo`)
}

// Moneda de visualización del catálogo: la configurada explícitamente, si no la
// de consolidación del cliente, si no la funcional de su empresa, si no CUP.
async function resolverMonedaCatalogo(
  db: ReturnType<typeof createAdminClient>,
  clientId: string,
  configurada: string | null,
): Promise<string> {
  if (configurada) return configurada
  const [{ data: consol }, { data: emp }] = await Promise.all([
    db.from('monedas').select('codigo').eq('client_id', clientId).eq('es_consolidacion', true).maybeSingle(),
    db.from('empresas').select('moneda_funcional').eq('client_id', clientId).limit(1).maybeSingle(),
  ])
  return (consol?.codigo as string | null) || (emp?.moneda_funcional as string | null) || 'CUP'
}

// Descuento efectivo de un ítem (%): el suyo si > 0, si no el de su categoría.
// Acotado a [0, 100].
function descuentoEfectivo(
  item: { descuento_pct?: number | null; categoria_id: string | null },
  catDto: Map<string, number>,
): number {
  const propio = Number(item.descuento_pct) || 0
  const pct = propio > 0 ? propio : (item.categoria_id ? (catDto.get(item.categoria_id) ?? 0) : 0)
  return Math.min(Math.max(pct, 0), 100)
}

// Añade a cada ítem el precio FINAL (con descuento efectivo) convertido a la
// moneda del catálogo, el precio original convertido (`precioAntes`, solo si hay
// descuento) y el `descuentoPct` aplicado. Si falta la tasa del par, cae al
// importe en su moneda original. `catDto` mapea categoria_id → descuento_pct.
function conPreciosConvertidos<T extends { precio: number | null; moneda: string | null; descuento_pct?: number | null; categoria_id: string | null }>(
  items: T[], monedaCatalogo: string, conv: { convertir(m: number, o: string, d: string): number | null }, catDto: Map<string, number>,
): (T & { precioMostrado: number | null; monedaMostrada: string | null; precioAntes: number | null; descuentoPct: number })[] {
  return items.map(i => {
    const precio = i.precio == null ? null : Number(i.precio)
    const pct = descuentoEfectivo(i, catDto)
    let precioMostrado: number | null = null
    let monedaMostrada: string | null = null
    let precioAntes: number | null = null
    if (precio != null) {
      const origen = i.moneda || monedaCatalogo
      const final = pct > 0 ? Math.round(precio * (1 - pct / 100) * 100) / 100 : precio
      const cFinal = conv.convertir(final, origen, monedaCatalogo)
      if (cFinal != null) {
        precioMostrado = cFinal; monedaMostrada = monedaCatalogo
        precioAntes = pct > 0 ? conv.convertir(precio, origen, monedaCatalogo) : null
      } else {
        precioMostrado = final; monedaMostrada = origen
        precioAntes = pct > 0 ? precio : null
      }
    }
    return { ...i, precio, precioMostrado, monedaMostrada, precioAntes, descuentoPct: pct }
  })
}

// Mapa categoria_id → descuento_pct (para el descuento efectivo por herencia).
function mapaDescuentoCategorias(categorias: { categoria_id: string; descuento_pct?: number | null }[]): Map<string, number> {
  return new Map(categorias.map(c => [c.categoria_id, Number(c.descuento_pct) || 0]))
}

// Stock (products.stock_actual) de los ítems vinculados a Inventario. Solo para
// el portal (dueño); nunca se expone en el catálogo público.
async function stockDeItems(
  db: ReturnType<typeof createAdminClient>, clientId: string, items: { producto_id: string | null }[],
): Promise<Map<string, number>> {
  const ids = [...new Set(items.map(i => i.producto_id).filter((x): x is string => !!x))]
  if (ids.length === 0) return new Map()
  const { data } = await db.from('products').select('producto_id, stock_actual')
    .eq('client_id', clientId).in('producto_id', ids)
  return new Map((data ?? []).map(p => [p.producto_id as string, Number(p.stock_actual) || 0]))
}

// ── Cargar el catálogo del negocio (portal) ────────────────────────────────────

export interface CatalogoData {
  categorias:    CatalogoCategoria[]
  items:         CatalogoItem[]
  slug:          string | null
  etiquetas:     EtiquetasSector
  monedaCatalogo: string
  monedasActivas: MonedaOpcion[]
  tieneInventario: boolean
}

export async function obtenerCatalogo(): Promise<CatalogoData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()

  const [{ data: cliente }, { data: categorias }, { data: items }, { data: monedasRows }] = await Promise.all([
    db.from('clients').select('slug, sector, modulos_activos, catalogo_moneda').eq('client_id', session.client_id).single(),
    db.from('catalogo_categorias').select('*').eq('client_id', session.client_id).order('orden'),
    db.from('catalogo_items').select('*').eq('client_id', session.client_id).order('orden'),
    db.from('monedas').select('codigo, simbolo').eq('client_id', session.client_id).eq('activa', true)
      .order('es_consolidacion', { ascending: false }).order('codigo'),
  ])

  const modulos: string[] = Array.isArray(cliente?.modulos_activos) ? cliente.modulos_activos : []
  const tieneInventario = modulos.includes('inventario')
  const monedaCatalogo = await resolverMonedaCatalogo(db, session.client_id, (cliente?.catalogo_moneda as string | null) ?? null)
  const conv = await construirConversor(db, session.client_id)

  const cats = (categorias ?? []) as CatalogoCategoria[]
  const itemsRaw = (items ?? []) as CatalogoItem[]
  const itemsConv = conPreciosConvertidos(itemsRaw, monedaCatalogo, conv, mapaDescuentoCategorias(cats))

  // Stock informativo (solo dueño) de los ítems vinculados a Inventario.
  const stockMap = tieneInventario ? await stockDeItems(db, session.client_id, itemsRaw) : new Map<string, number>()
  const itemsConStock = itemsConv.map(i => ({ ...i, stock: i.producto_id ? (stockMap.get(i.producto_id) ?? null) : null }))

  return {
    categorias: cats,
    items:      itemsConStock,
    slug:       (cliente?.slug as string | null) ?? null,
    etiquetas:  await etiquetasDeSector(db, (cliente?.sector as string | null) ?? null),
    monedaCatalogo,
    monedasActivas: ((monedasRows ?? []) as { codigo: string; simbolo: string | null }[]).map(m => ({ codigo: m.codigo, simbolo: m.simbolo || m.codigo })),
    tieneInventario,
  }
}

// ── Categorías ──────────────────────────────────────────────────────────────────

export async function guardarCategoria(formData: FormData): Promise<{ ok: boolean; error?: string; categoria_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const nombre = ((formData.get('nombre') as string) ?? '').trim()
  if (!nombre) return { ok: false, error: 'El nombre es obligatorio.' }
  const categoria_id_form = ((formData.get('categoria_id') as string) ?? '').trim()
  const descRaw = Number(((formData.get('descuento_pct') as string) ?? '').replace(',', '.'))
  const descuento_pct = Math.min(Math.max(isNaN(descRaw) ? 0 : descRaw, 0), 100)

  const db = createAdminClient()

  if (!categoria_id_form) {
    const { count } = await db.from('catalogo_categorias')
      .select('categoria_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id)
    const categoria_id = genId('CATCAT')
    const { error } = await db.from('catalogo_categorias').insert({
      categoria_id, client_id: session.client_id, nombre, descuento_pct, orden: count ?? 0,
    })
    if (error) return { ok: false, error: error.message }
    revalidatePath('/portal/catalogo')
    await revalidarPublico(db, session.client_id)
    return { ok: true, categoria_id }
  }

  const { error } = await db.from('catalogo_categorias')
    .update({ nombre, descuento_pct, updated_at: new Date().toISOString() })
    .eq('categoria_id', categoria_id_form).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/catalogo')
  await revalidarPublico(db, session.client_id)
  return { ok: true, categoria_id: categoria_id_form }
}

export async function eliminarCategoria(categoria_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  // Los ítems de la categoría quedan sin categoría (FK on delete set null); no se borran.
  const { error } = await db.from('catalogo_categorias').delete()
    .eq('categoria_id', categoria_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/catalogo')
  await revalidarPublico(db, session.client_id)
  return { ok: true }
}

// ── Ítems ───────────────────────────────────────────────────────────────────────

export async function guardarItem(formData: FormData): Promise<{ ok: boolean; error?: string; item_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const nombre = ((formData.get('nombre') as string) ?? '').trim()
  if (!nombre) return { ok: false, error: 'El nombre es obligatorio.' }

  const num = (k: string): number | null => {
    const v = (formData.get(k) as string ?? '').trim()
    if (!v) return null
    const n = Number(v.replace(',', '.'))
    return isNaN(n) ? null : n
  }
  const str = (k: string): string | null => ((formData.get(k) as string) ?? '').trim() || null

  const clampPct = (n: number | null): number => Math.min(Math.max(n ?? 0, 0), 100)

  const item_id_form = ((formData.get('item_id') as string) ?? '').trim()
  const campos = {
    categoria_id: str('categoria_id'),
    nombre,
    descripcion:  str('descripcion'),
    precio:       num('precio'),
    moneda:       str('moneda'),
    ingredientes: str('ingredientes'),
    alergenos:    str('alergenos'),
    calorias:     num('calorias') == null ? null : Math.round(num('calorias') as number),
    descuento_pct: clampPct(num('descuento_pct')),
    disponible:   formData.get('disponible') !== 'false',
    updated_at:   new Date().toISOString(),
  }

  const db = createAdminClient()

  if (!item_id_form) {
    const { count } = await db.from('catalogo_items')
      .select('item_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id)
    const item_id = genId('CATITM')
    const { error } = await db.from('catalogo_items').insert({
      item_id, client_id: session.client_id, orden: count ?? 0, ...campos,
    })
    if (error) return { ok: false, error: error.message }
    revalidatePath('/portal/catalogo')
    await revalidarPublico(db, session.client_id)
    return { ok: true, item_id }
  }

  const { error } = await db.from('catalogo_items').update(campos)
    .eq('item_id', item_id_form).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/catalogo')
  await revalidarPublico(db, session.client_id)
  return { ok: true, item_id: item_id_form }
}

export async function eliminarItem(item_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  // Borrar la foto del bucket si la hay (best-effort).
  const { data: item } = await db.from('catalogo_items')
    .select('foto_path').eq('item_id', item_id).eq('client_id', session.client_id).maybeSingle()
  if (item?.foto_path) {
    await db.storage.from('catalogo').remove([item.foto_path as string, `${item.foto_path}`.replace(/\.webp$/, '_thumb.webp')])
  }
  const { error } = await db.from('catalogo_items').delete()
    .eq('item_id', item_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/catalogo')
  await revalidarPublico(db, session.client_id)
  return { ok: true }
}

// Toggle rápido de disponibilidad ("agotado") desde la tarjeta del ítem.
export async function marcarDisponible(item_id: string, disponible: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { error } = await db.from('catalogo_items')
    .update({ disponible, updated_at: new Date().toISOString() })
    .eq('item_id', item_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/catalogo')
  await revalidarPublico(db, session.client_id)
  return { ok: true }
}

// ── Subir foto del ítem (optimización servidor) ────────────────────────────────

export async function subirFotoItem(formData: FormData): Promise<{ ok: boolean; error?: string; foto_url?: string; foto_thumb_url?: string }> {
  const session = await getPortalSession()
  if (!session || session.solo_lectura) return { ok: false, error: 'Sin permisos.' }

  const item_id = ((formData.get('item_id') as string) ?? '').trim()
  const file    = formData.get('foto') as File | null
  if (!item_id) return { ok: false, error: 'item_id requerido.' }
  if (!file || file.size === 0) return { ok: false, error: 'No se recibió archivo.' }
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: 'La imagen no puede superar 8 MB.' }
  if (!file.type.startsWith('image/')) return { ok: false, error: 'El archivo debe ser una imagen.' }

  const db = createAdminClient()
  const { data: item } = await db.from('catalogo_items')
    .select('item_id').eq('item_id', item_id).eq('client_id', session.client_id).maybeSingle()
  if (!item) return { ok: false, error: 'Ítem no encontrado.' }

  // Optimización garantizada por el sistema: WebP a tamaño/calidad fijos + thumb.
  let full: Buffer, thumb: Buffer
  try {
    const entrada = Buffer.from(await file.arrayBuffer())
    const opt = await optimizarImagen(entrada)
    full = opt.full; thumb = opt.thumb
  } catch (e) {
    return { ok: false, error: `No se pudo procesar la imagen: ${(e as Error).message}` }
  }

  const path      = `${session.client_id}/${item_id}.webp`
  const pathThumb = `${session.client_id}/${item_id}_thumb.webp`

  const up1 = await db.storage.from('catalogo').upload(path, full, { contentType: 'image/webp', upsert: true })
  if (up1.error) return { ok: false, error: up1.error.message }
  const up2 = await db.storage.from('catalogo').upload(pathThumb, thumb, { contentType: 'image/webp', upsert: true })
  if (up2.error) return { ok: false, error: up2.error.message }

  const { data: { publicUrl } }      = db.storage.from('catalogo').getPublicUrl(path)
  const { data: { publicUrl: thumbUrl } } = db.storage.from('catalogo').getPublicUrl(pathThumb)
  // Evita caché obsoleta tras reemplazar la foto (mismo path, upsert).
  const bust = `?v=${Date.now()}`
  const foto_url = publicUrl + bust
  const foto_thumb_url = thumbUrl + bust

  await db.from('catalogo_items').update({
    foto_url, foto_thumb_url, foto_path: path, updated_at: new Date().toISOString(),
  }).eq('item_id', item_id).eq('client_id', session.client_id)

  revalidatePath('/portal/catalogo')
  await revalidarPublico(db, session.client_id)
  return { ok: true, foto_url, foto_thumb_url }
}

export async function quitarFotoItem(item_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session || session.solo_lectura) return { ok: false, error: 'Sin permisos.' }
  const db = createAdminClient()
  const { data: item } = await db.from('catalogo_items')
    .select('foto_path').eq('item_id', item_id).eq('client_id', session.client_id).maybeSingle()
  if (item?.foto_path) {
    const path = item.foto_path as string
    await db.storage.from('catalogo').remove([path, path.replace(/\.webp$/, '_thumb.webp')])
  }
  const { error } = await db.from('catalogo_items')
    .update({ foto_url: null, foto_thumb_url: null, foto_path: null, updated_at: new Date().toISOString() })
    .eq('item_id', item_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/catalogo')
  await revalidarPublico(db, session.client_id)
  return { ok: true }
}

// ── Slug público (mismo `clients.slug` que Reservas/Citas) ──────────────────────

export async function guardarSlug(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const slugRaw = ((formData.get('slug') as string) ?? '').trim()
  let slug: string | null = null
  if (slugRaw) {
    slug = normalizarSlug(slugRaw)
    if (!slug || slug.length < 2) return { ok: false, error: 'Mínimo 2 caracteres (letras, números o guiones).' }
    const db = createAdminClient()
    const { data: existente } = await db.from('clients').select('client_id')
      .eq('slug', slug).neq('client_id', session.client_id).maybeSingle()
    if (existente) return { ok: false, error: 'Ese enlace ya lo está usando otro negocio.' }
  }

  const db = createAdminClient()
  const { error } = await db.from('clients').update({ slug }).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/catalogo')
  if (slug) revalidatePath(`/${slug}/catalogo`)
  return { ok: true }
}

// ── Moneda de visualización del catálogo ───────────────────────────────────────

export async function guardarMonedaCatalogo(moneda: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const val = (moneda ?? '').trim().toUpperCase() || null
  const db = createAdminClient()
  const { error } = await db.from('clients').update({ catalogo_moneda: val }).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/catalogo')
  await revalidarPublico(db, session.client_id)
  return { ok: true }
}

// ── Importar desde Inventario (conveniencia; solo si el módulo está activo) ─────

export async function importarDesdeProductos(): Promise<{ ok: boolean; error?: string; creados?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { data: cliente } = await db.from('clients').select('modulos_activos, catalogo_moneda').eq('client_id', session.client_id).single()
  const modulos: string[] = Array.isArray(cliente?.modulos_activos) ? cliente.modulos_activos : []
  if (!modulos.includes('inventario')) return { ok: false, error: 'El módulo Inventario no está activo.' }

  // Monedas válidas del cliente: cualquier precio en una moneda que no exista
  // en su modelo se normaliza a la moneda del catálogo (evita datos como "CUB"
  // que luego no se pueden convertir y aparecen sin actualizar).
  const monedaCatalogo = await resolverMonedaCatalogo(db, session.client_id, (cliente?.catalogo_moneda as string | null) ?? null)
  const { data: monedasRows } = await db.from('monedas').select('codigo').eq('client_id', session.client_id)
  const monedasValidas = new Set((monedasRows ?? []).map(m => m.codigo as string))

  const { data: productos } = await db.from('products')
    .select('producto_id, nombre, descripcion, precios')
    .eq('client_id', session.client_id).eq('estado', 'ACTIVO')

  if (!productos?.length) return { ok: true, creados: 0 }

  // No duplicar: saltar productos ya vinculados.
  const { data: yaVinculados } = await db.from('catalogo_items')
    .select('producto_id').eq('client_id', session.client_id).not('producto_id', 'is', null)
  const vinculados = new Set((yaVinculados ?? []).map(r => r.producto_id as string))

  const { count } = await db.from('catalogo_items')
    .select('item_id', { count: 'exact', head: true }).eq('client_id', session.client_id)
  let orden = count ?? 0

  const nuevos = productos
    .filter(p => !vinculados.has(p.producto_id as string))
    .map(p => {
      // precios es JSONB {moneda: importe}; preferimos un precio en una moneda
      // válida del cliente; si ninguna lo es, tomamos el primero y normalizamos
      // su moneda a la del catálogo.
      const precios = (p.precios ?? {}) as Record<string, number>
      const entradas = Object.entries(precios)
      const valida = entradas.find(([m]) => monedasValidas.has(m))
      const [monedaRaw, precio] = valida ?? entradas[0] ?? [null, null]
      const moneda = monedaRaw != null && monedasValidas.has(monedaRaw) ? monedaRaw : monedaCatalogo
      return {
        item_id: genId('CATITM'),
        client_id: session.client_id,
        nombre: p.nombre as string,
        descripcion: (p.descripcion as string | null) ?? null,
        precio: precio == null ? null : Number(precio),
        moneda: precio == null ? null : moneda,
        producto_id: p.producto_id as string,
        orden: orden++,
      }
    })

  if (!nuevos.length) return { ok: true, creados: 0 }
  const { error } = await db.from('catalogo_items').insert(nuevos)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/catalogo')
  await revalidarPublico(db, session.client_id)
  return { ok: true, creados: nuevos.length }
}

// ── Catálogo público (por slug, sin sesión) ────────────────────────────────────

export interface CatalogoPublicoItem {
  item_id: string
  nombre: string
  descripcion: string | null
  precio: number | null            // precio FINAL (con descuento) convertido a la moneda del catálogo
  precioAntes: number | null       // precio original convertido, solo si hay descuento
  descuentoPct: number             // descuento efectivo aplicado (%)
  moneda: string | null            // moneda mostrada (la del catálogo, o la original si falta tasa)
  foto_url: string | null
  foto_thumb_url: string | null
  ingredientes: string | null
  alergenos: string | null
  calorias: number | null
  disponible: boolean
}
export interface CatalogoPublicoCategoria {
  categoria_id: string
  nombre: string
  items: CatalogoPublicoItem[]
}
export interface CatalogoPublico {
  negocio: { nombre: string; logo_url: string | null } | null
  categorias: CatalogoPublicoCategoria[]
  etiquetas: EtiquetasSector
  tieneReservas: boolean
  tieneCitas: boolean
}

export interface CatalogoItemPublicoDetalle extends CatalogoPublicoItem {
  categoriaNombre: string | null
  negocio: { nombre: string; slug: string } | null
  etiquetaCatalogo: string
  catalogoIcono: import('@/lib/sector').CatalogoIcono
}

// Detalle público de un ítem (por slug + item_id, sin sesión). Para la página
// /[slug]/catalogo/[itemId].
export async function obtenerItemPublico(slug: string, itemId: string): Promise<CatalogoItemPublicoDetalle | null> {
  const db = createAdminClient()
  const { data: cliente } = await db.from('clients')
    .select('client_id, nombre_empresa, sector, modulos_activos, catalogo_moneda')
    .eq('slug', slug).maybeSingle()
  if (!cliente) return null
  const modulos: string[] = Array.isArray(cliente.modulos_activos) ? cliente.modulos_activos : []
  if (!modulos.includes('catalogo_qr')) return null

  const { data: item } = await db.from('catalogo_items').select('*')
    .eq('item_id', itemId).eq('client_id', cliente.client_id as string).eq('activo', true).maybeSingle()
  if (!item) return null

  const it = item as CatalogoItem
  const monedaCatalogo = await resolverMonedaCatalogo(db, cliente.client_id as string, (cliente.catalogo_moneda as string | null) ?? null)
  const [conv, etiquetas, categoria] = await Promise.all([
    construirConversor(db, cliente.client_id as string),
    etiquetasDeSector(db, (cliente.sector as string | null) ?? null),
    it.categoria_id
      ? db.from('catalogo_categorias').select('nombre, descuento_pct')
          .eq('categoria_id', it.categoria_id).eq('activa', true).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const catDto = new Map<string, number>()
  if (it.categoria_id) catDto.set(it.categoria_id, Number(categoria?.data?.descuento_pct) || 0)
  const [c] = conPreciosConvertidos([it], monedaCatalogo, conv, catDto)
  return {
    item_id: c.item_id, nombre: c.nombre, descripcion: c.descripcion,
    precio: c.precioMostrado, precioAntes: c.precioAntes, descuentoPct: c.descuentoPct,
    moneda: c.monedaMostrada,
    foto_url: c.foto_url, foto_thumb_url: c.foto_thumb_url,
    ingredientes: c.ingredientes, alergenos: c.alergenos, calorias: c.calorias,
    disponible: c.disponible,
    categoriaNombre: (categoria?.data?.nombre as string | null) ?? null,
    negocio: { nombre: cliente.nombre_empresa as string, slug },
    etiquetaCatalogo: etiquetas.catalogo,
    catalogoIcono: etiquetas.catalogoIcono,
  }
}

export async function obtenerCatalogoPublico(slug: string): Promise<CatalogoPublico> {
  const vacio: CatalogoPublico = { negocio: null, categorias: [], etiquetas: { ...ETIQUETAS_DEFAULT }, tieneReservas: false, tieneCitas: false }
  const db = createAdminClient()

  const { data: cliente } = await db.from('clients')
    .select('client_id, nombre_empresa, sector, modulos_activos, catalogo_moneda')
    .eq('slug', slug).maybeSingle()
  if (!cliente) return vacio

  const modulos: string[] = Array.isArray(cliente.modulos_activos) ? cliente.modulos_activos : []
  if (!modulos.includes('catalogo_qr')) return vacio

  const [{ data: categorias }, { data: items }, { data: empresa }, etiquetas, conv, monedaCatalogo] = await Promise.all([
    db.from('catalogo_categorias').select('categoria_id, nombre, orden, descuento_pct')
      .eq('client_id', cliente.client_id).eq('activa', true).order('orden'),
    db.from('catalogo_items').select('*')
      .eq('client_id', cliente.client_id).eq('activo', true).order('orden'),
    db.from('empresas').select('logo_url, mostrar_logo').eq('client_id', cliente.client_id).limit(1).maybeSingle(),
    etiquetasDeSector(db, (cliente.sector as string | null) ?? null),
    construirConversor(db, cliente.client_id as string),
    resolverMonedaCatalogo(db, cliente.client_id as string, (cliente.catalogo_moneda as string | null) ?? null),
  ])

  const catDto = mapaDescuentoCategorias((categorias ?? []) as { categoria_id: string; descuento_pct: number }[])
  const itemsConv = conPreciosConvertidos((items ?? []) as CatalogoItem[], monedaCatalogo, conv, catDto)

  const itemsPorCat = new Map<string | null, CatalogoPublicoItem[]>()
  for (const i of itemsConv) {
    const key = i.categoria_id
    if (!itemsPorCat.has(key)) itemsPorCat.set(key, [])
    itemsPorCat.get(key)!.push({
      item_id: i.item_id, nombre: i.nombre, descripcion: i.descripcion,
      precio: i.precioMostrado, precioAntes: i.precioAntes, descuentoPct: i.descuentoPct,
      moneda: i.monedaMostrada,
      foto_url: i.foto_url, foto_thumb_url: i.foto_thumb_url,
      ingredientes: i.ingredientes, alergenos: i.alergenos, calorias: i.calorias,
      disponible: i.disponible,
    })
  }

  const cats: CatalogoPublicoCategoria[] = ((categorias ?? []) as { categoria_id: string; nombre: string }[])
    .map(c => ({ categoria_id: c.categoria_id, nombre: c.nombre, items: itemsPorCat.get(c.categoria_id) ?? [] }))
    .filter(c => c.items.length > 0)

  // Ítems sin categoría → grupo final "Otros" si los hay.
  const sinCat = itemsPorCat.get(null)
  if (sinCat?.length) cats.push({ categoria_id: '__sin__', nombre: 'Otros', items: sinCat })

  const logo = empresa?.mostrar_logo ? ((empresa?.logo_url as string | null) ?? null) : null

  return {
    negocio: { nombre: cliente.nombre_empresa as string, logo_url: logo },
    categorias: cats,
    etiquetas,
    tieneReservas: modulos.includes('reservas_citas'),
    tieneCitas: modulos.includes('agenda'),
  }
}
