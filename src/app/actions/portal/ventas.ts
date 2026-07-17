'use server'

import { revalidatePath }    from 'next/cache'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { tieneModulo }       from '@/lib/modulos'
import { monedaValida }      from '@/lib/tasas'
import {
  calcularTotales,
  formatoNumero,
  ESTADO_OFERTA_LABEL,
  ESTADO_FACTURA_LABEL,
  type AjusteInput,
  type AjusteModo,
  type AjusteTipo,
  type DocumentoTipo,
  type EstadoFactura,
  type EstadoOferta,
  type LineaInput,
} from '@/app/portal/(app)/ventas/_ventas-helpers'

// ── Tipos persistidos ─────────────────────────────────────────────────────────

export interface Oferta {
  oferta_id:      string
  numero:         string
  client_id:      string
  empresa_id:     string
  cliente_id:     string
  fecha_emision:  string
  fecha_validez:  string | null
  moneda:         string
  estado:         EstadoOferta
  condicion_pago: string
  subtotal:       number
  total:          number
  notas:          string | null
  notas_internas: string | null
  factura_id:     string | null
  archivado:      boolean
  created_at:     string
  updated_at:     string
}

export interface Factura {
  factura_id:        string
  numero:            string
  client_id:         string
  empresa_id:        string
  oferta_id:         string | null
  cliente_id:        string
  fecha_emision:     string
  fecha_vencimiento: string | null
  moneda:            string
  estado:            EstadoFactura
  condicion_pago:    string
  subtotal:          number
  total:             number
  notas:             string | null
  notas_internas:    string | null
  archivado:         boolean
  created_at:        string
  updated_at:        string
}

export interface DocumentoLinea {
  linea_id:          number
  documento_tipo:    DocumentoTipo
  documento_id:      string
  orden:             number
  producto_id:       string | null
  descripcion:       string
  cantidad:          number
  precio_unitario:   number
  descuento_pct:     number
  descuento_importe: number
  total:             number
}

export interface DocumentoAjuste {
  ajuste_id:       number
  documento_tipo:  DocumentoTipo
  documento_id:    string
  orden:           number
  tipo:            AjusteTipo
  nombre:          string
  modo:            AjusteModo
  valor:           number
  monto_calculado: number
}

export interface VentasResumenData {
  ofertas:           Oferta[]
  facturas:          Factura[]
  empresas:          { empresa_id: string; nombre: string; letra_facturacion: string | null }[]
  empresa_nombres:   Record<string, string>
  clientes:          { tercero_id: string; nombre: string; empresa_id: string; moneda_defecto: string | null; identificacion: string | null; direccion: string | null; ciudad: string | null; pais: string | null; email: string | null; telefono: string | null }[]
  cliente_nombres:   Record<string, string>
  productos:         { producto_id: string; codigo: string; nombre: string; unidad: string; precios: Record<string, number> }[]
  monedas:           string[]
}

export interface OfertaDetalleData {
  oferta:   Oferta
  empresa:  { empresa_id: string; nombre: string; nombre_fiscal: string | null; rif_nit: string | null; direccion: string | null; ciudad: string | null; pais: string | null; telefono: string | null; email: string | null; logo_url: string | null; letra_facturacion: string | null; color: string }
  cliente:  { tercero_id: string; nombre: string; identificacion: string | null; direccion: string | null; ciudad: string | null; pais: string | null; email: string | null; telefono: string | null }
  lineas:   DocumentoLinea[]
  ajustes:  DocumentoAjuste[]
  factura?: { factura_id: string; numero: string } | null
}

export interface FacturaDetalleData {
  factura:  Factura
  empresa:  OfertaDetalleData['empresa']
  cliente:  OfertaDetalleData['cliente']
  lineas:   DocumentoLinea[]
  ajustes:  DocumentoAjuste[]
  oferta?:  { oferta_id: string; numero: string } | null
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function generarId(prefijo: 'OFE' | 'FAC'): string {
  return `${prefijo}-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

function parseJSON<T>(s: FormDataEntryValue | null, fallback: T): T {
  if (!s || typeof s !== 'string') return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

/**
 * Reserva y retorna el siguiente número correlativo para (empresa, tipo, año).
 * Atómico vía UPSERT con returning. El número devuelto se debe combinar con
 * la letra de empresa para formar el código visible.
 */
async function siguienteCorrelativo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db:         any,
  client_id:  string,
  empresa_id: string,
  tipo:       DocumentoTipo,
  anio:       number,
): Promise<number> {
  // Intentar incremento atómico vía RPC sería ideal, pero hacemos read-modify-write
  // con un upsert seguro: lee el actual, incrementa, escribe. La unicidad final del
  // número está garantizada por el índice único en (client_id, numero) de cada tabla.
  const { data: existente } = await db
    .from('consecutivos_venta')
    .select('ultimo_numero')
    .eq('client_id',  client_id)
    .eq('empresa_id', empresa_id)
    .eq('tipo',       tipo)
    .eq('anio',       anio)
    .maybeSingle()

  const nuevo = (existente?.ultimo_numero ?? 0) + 1

  const { error } = await db
    .from('consecutivos_venta')
    .upsert({
      client_id, empresa_id, tipo, anio,
      ultimo_numero: nuevo,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'client_id,empresa_id,tipo,anio' })

  if (error) throw new Error(`No se pudo reservar consecutivo: ${error.message}`)
  return nuevo
}

async function validarEmpresaAccesible(
  empresa_id: string,
): Promise<{ ok: true; letra: string } | { ok: false; error: string }> {
  const empresas = await obtenerEmpresas()
  const emp = empresas.find(e => e.empresa_id === empresa_id)
  if (!emp)            return { ok: false, error: 'Empresa no válida.' }
  if (!emp.letra_facturacion) {
    return { ok: false, error: `La empresa "${emp.nombre}" no tiene letra de facturación asignada. Configúrala en Mis Empresas.` }
  }
  return { ok: true, letra: emp.letra_facturacion }
}

// ── Obtener resumen (hub) ─────────────────────────────────────────────────────

export async function obtenerVentasResumen(): Promise<VentasResumenData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db       = createAdminClient()
  const empresas = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  if (!empresa_ids.length) {
    return {
      ofertas: [], facturas: [],
      empresas: [], empresa_nombres: {},
      clientes: [], cliente_nombres: {},
      productos: [], monedas: [],
    }
  }

  // Gate por módulo Inventario: el selector de productos es una conveniencia de
  // llenado rápido. Sin Inventario, las líneas se rellenan con texto libre (la base
  // funciona sola); con Inventario, se ofrece el datalist de productos.
  const { data: clienteRow } = await db
    .from('clients')
    .select('modulos_activos')
    .eq('client_id', session.client_id)
    .single()
  const tieneInventario = tieneModulo(clienteRow?.modulos_activos, 'inventario')

  const [ofRes, faRes, cliRes, prodRes, monRes] = await Promise.all([
    db.from('ofertas').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', empresa_ids)
      .order('created_at', { ascending: false }),
    db.from('facturas').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', empresa_ids)
      .order('created_at', { ascending: false }),
    db.from('third_parties')
      .select('tercero_id, nombre, empresa_id, moneda_defecto, tipo, activo, identificacion, direccion, ciudad, pais, email, telefono')
      .eq('client_id', session.client_id)
      .in('empresa_id', empresa_ids)
      .in('tipo', ['CLIENTE', 'AMBOS'])
      .eq('activo', true)
      .order('nombre'),
    tieneInventario
      ? db.from('products')
          .select('producto_id, codigo, nombre, unidad, precios')
          .eq('client_id', session.client_id)
          .eq('estado', 'ACTIVO')
          .order('nombre')
      : Promise.resolve({ data: [] as VentasResumenData['productos'] }),
    db.from('monedas')
      .select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('codigo'),
  ])

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  const cliente_nombres: Record<string, string> = {}
  for (const c of (cliRes.data ?? [])) cliente_nombres[c.tercero_id] = c.nombre

  return {
    ofertas:          (ofRes.data  ?? []) as Oferta[],
    facturas:         (faRes.data  ?? []) as Factura[],
    empresas:         empresas.map(e => ({
                        empresa_id:        e.empresa_id,
                        nombre:            e.nombre,
                        letra_facturacion: e.letra_facturacion,
                      })),
    empresa_nombres,
    clientes:         (cliRes.data ?? []).map((c: { tercero_id: string; nombre: string; empresa_id: string; moneda_defecto: string | null; identificacion: string | null; direccion: string | null; ciudad: string | null; pais: string | null; email: string | null; telefono: string | null }) => ({
                        tercero_id:     c.tercero_id,
                        nombre:         c.nombre,
                        empresa_id:     c.empresa_id,
                        moneda_defecto: c.moneda_defecto,
                        identificacion: c.identificacion,
                        direccion:      c.direccion,
                        ciudad:         c.ciudad,
                        pais:           c.pais,
                        email:          c.email,
                        telefono:       c.telefono,
                      })),
    cliente_nombres,
    productos:        (prodRes.data ?? []) as VentasResumenData['productos'],
    monedas:          ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo),
  }
}

// ── Obtener detalle de oferta ─────────────────────────────────────────────────

export async function obtenerOfertaDetalle(
  oferta_id: string,
): Promise<OfertaDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const { data: oferta } = await db
    .from('ofertas').select('*')
    .eq('oferta_id', oferta_id)
    .eq('client_id', session.client_id)
    .maybeSingle()

  if (!oferta) return null

  // empresa, cliente, líneas, ajustes y factura solo dependen de la oferta ya
  // cargada (no entre sí) → una sola tanda en paralelo (antes eran secuenciales).
  const [empRes, cliRes, linRes, ajuRes, facRes] = await Promise.all([
    db.from('empresas')
      .select('empresa_id, nombre, nombre_fiscal, rif_nit, direccion, ciudad, pais, telefono, email, logo_url, letra_facturacion, color')
      .eq('empresa_id', oferta.empresa_id)
      .eq('client_id',  session.client_id)
      .maybeSingle(),
    db.from('third_parties')
      .select('tercero_id, nombre, identificacion, direccion, ciudad, pais, email, telefono')
      .eq('tercero_id', oferta.cliente_id)
      .eq('client_id',  session.client_id)
      .maybeSingle(),
    db.from('documento_lineas').select('*')
      .eq('documento_tipo', 'OFERTA').eq('documento_id', oferta_id).order('orden'),
    db.from('documento_ajustes').select('*')
      .eq('documento_tipo', 'OFERTA').eq('documento_id', oferta_id).order('orden'),
    oferta.factura_id
      ? db.from('facturas').select('factura_id, numero').eq('factura_id', oferta.factura_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const empresa = empRes.data
  if (!empresa) return null
  const cliente = cliRes.data
  if (!cliente) return null
  const factura = (facRes.data ?? null) as { factura_id: string; numero: string } | null

  return {
    oferta:  oferta as Oferta,
    empresa,
    cliente,
    lineas:  (linRes.data ?? []) as DocumentoLinea[],
    ajustes: (ajuRes.data ?? []) as DocumentoAjuste[],
    factura,
  }
}

// ── Obtener detalle de factura ────────────────────────────────────────────────

export async function obtenerFacturaDetalle(
  factura_id: string,
): Promise<FacturaDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const { data: factura } = await db
    .from('facturas').select('*')
    .eq('factura_id', factura_id)
    .eq('client_id', session.client_id)
    .maybeSingle()
  if (!factura) return null

  // empresa, cliente, líneas, ajustes y oferta solo dependen de la factura ya
  // cargada → una sola tanda en paralelo (antes eran secuenciales).
  const [empRes, cliRes, linRes, ajuRes, ofeRes] = await Promise.all([
    db.from('empresas')
      .select('empresa_id, nombre, nombre_fiscal, rif_nit, direccion, ciudad, pais, telefono, email, logo_url, letra_facturacion, color')
      .eq('empresa_id', factura.empresa_id)
      .eq('client_id',  session.client_id)
      .maybeSingle(),
    db.from('third_parties')
      .select('tercero_id, nombre, identificacion, direccion, ciudad, pais, email, telefono')
      .eq('tercero_id', factura.cliente_id)
      .eq('client_id',  session.client_id)
      .maybeSingle(),
    db.from('documento_lineas').select('*')
      .eq('documento_tipo', 'FACTURA').eq('documento_id', factura_id).order('orden'),
    db.from('documento_ajustes').select('*')
      .eq('documento_tipo', 'FACTURA').eq('documento_id', factura_id).order('orden'),
    factura.oferta_id
      ? db.from('ofertas').select('oferta_id, numero').eq('oferta_id', factura.oferta_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const empresa = empRes.data
  if (!empresa) return null
  const cliente = cliRes.data
  if (!cliente) return null
  const oferta = (ofeRes.data ?? null) as { oferta_id: string; numero: string } | null

  return {
    factura: factura as Factura,
    empresa,
    cliente,
    lineas:  (linRes.data ?? []) as DocumentoLinea[],
    ajustes: (ajuRes.data ?? []) as DocumentoAjuste[],
    oferta,
  }
}

// ── Guardar oferta (crear o editar) ───────────────────────────────────────────

export async function guardarOferta(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; oferta_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const oferta_id_form  = (formData.get('oferta_id')      as string)?.trim() || ''
  const empresa_id      = (formData.get('empresa_id')     as string)?.trim()
  const cliente_id      = (formData.get('cliente_id')     as string)?.trim()
  const moneda          = (formData.get('moneda')         as string)?.trim()
  const fecha_emision   = (formData.get('fecha_emision')  as string)?.trim()
  const fecha_validez   = (formData.get('fecha_validez')  as string)?.trim() || null
  const condicion_pago  = (formData.get('condicion_pago') as string)?.trim() || 'CONTADO'
  const notas           = (formData.get('notas')          as string)?.trim() || null
  const notas_internas  = (formData.get('notas_internas') as string)?.trim() || null

  if (!empresa_id) return { ok: false, error: 'Selecciona una empresa.' }
  if (!cliente_id) return { ok: false, error: 'Selecciona un cliente.' }
  if (!moneda)     return { ok: false, error: 'Selecciona una moneda.' }
  if (!fecha_emision) return { ok: false, error: 'La fecha de emisión es obligatoria.' }

  const lineas  = parseJSON<LineaInput[]>(formData.get('lineas'),  [])
  const ajustes = parseJSON<AjusteInput[]>(formData.get('ajustes'), [])
  if (lineas.length === 0) return { ok: false, error: 'Añade al menos una línea.' }

  const validacion = await validarEmpresaAccesible(empresa_id)
  if (!validacion.ok) return validacion

  const totales = calcularTotales(lineas, ajustes)
  const db      = createAdminClient()

  if (!oferta_id_form) {
    // ── Crear ──
    if (!await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
    }
    const anio    = new Date(fecha_emision).getFullYear()
    let correlativo: number
    try {
      correlativo = await siguienteCorrelativo(db, session.client_id, empresa_id, 'OFERTA', anio)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }

    const oferta_id = generarId('OFE')
    const numero    = formatoNumero('OFERTA', validacion.letra, anio, correlativo)

    const { error } = await db.from('ofertas').insert({
      oferta_id,
      numero,
      client_id:      session.client_id,
      empresa_id,
      cliente_id,
      fecha_emision,
      fecha_validez,
      moneda,
      estado:         'BORRADOR',
      condicion_pago,
      subtotal:       totales.subtotal,
      total:          totales.total,
      notas,
      notas_internas,
    })
    if (error) return { ok: false, error: error.message }

    await escribirLineasYAjustes(db, 'OFERTA', oferta_id, lineas, ajustes, totales)
    revalidatePath('/portal/ventas')
    return { ok: true, oferta_id }
  }

  // ── Editar ──
  const { data: actual } = await db
    .from('ofertas').select('estado, moneda')
    .eq('oferta_id', oferta_id_form)
    .eq('client_id', session.client_id)
    .maybeSingle()
  if (!actual)                       return { ok: false, error: 'Oferta no encontrada.' }
  if (actual.estado !== 'BORRADOR' && actual.estado !== 'ENVIADA') {
    return { ok: false, error: `No se puede editar una oferta en estado ${actual.estado}.` }
  }
  // Solo si cambia la moneda: una heredada que se desactivó no debe bloquear la edición.
  if (moneda !== actual.moneda && !await monedaValida(db, session.client_id, moneda)) {
    return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
  }

  const { error } = await db.from('ofertas')
    .update({
      cliente_id, fecha_emision, fecha_validez, moneda,
      condicion_pago, notas, notas_internas,
      subtotal:   totales.subtotal,
      total:      totales.total,
      updated_at: new Date().toISOString(),
    })
    .eq('oferta_id', oferta_id_form)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  // Reemplazar líneas y ajustes
  await db.from('documento_lineas')
    .delete().eq('documento_tipo', 'OFERTA').eq('documento_id', oferta_id_form)
  await db.from('documento_ajustes')
    .delete().eq('documento_tipo', 'OFERTA').eq('documento_id', oferta_id_form)
  await escribirLineasYAjustes(db, 'OFERTA', oferta_id_form, lineas, ajustes, totales)

  revalidatePath('/portal/ventas')
  revalidatePath(`/portal/ventas/ofertas/${oferta_id_form}`)
  return { ok: true, oferta_id: oferta_id_form }
}

// ── Guardar factura (crear o editar) ──────────────────────────────────────────

export async function guardarFactura(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; factura_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const factura_id_form  = (formData.get('factura_id')        as string)?.trim() || ''
  const empresa_id       = (formData.get('empresa_id')        as string)?.trim()
  const cliente_id       = (formData.get('cliente_id')        as string)?.trim()
  const moneda           = (formData.get('moneda')            as string)?.trim()
  const fecha_emision    = (formData.get('fecha_emision')     as string)?.trim()
  const fecha_vencimiento= (formData.get('fecha_vencimiento') as string)?.trim() || null
  const condicion_pago   = (formData.get('condicion_pago')    as string)?.trim() || 'CONTADO'
  const notas            = (formData.get('notas')             as string)?.trim() || null
  const notas_internas   = (formData.get('notas_internas')    as string)?.trim() || null

  if (!empresa_id) return { ok: false, error: 'Selecciona una empresa.' }
  if (!cliente_id) return { ok: false, error: 'Selecciona un cliente.' }
  if (!moneda)     return { ok: false, error: 'Selecciona una moneda.' }
  if (!fecha_emision) return { ok: false, error: 'La fecha de emisión es obligatoria.' }

  const lineas  = parseJSON<LineaInput[]>(formData.get('lineas'),  [])
  const ajustes = parseJSON<AjusteInput[]>(formData.get('ajustes'), [])
  if (lineas.length === 0) return { ok: false, error: 'Añade al menos una línea.' }

  const validacion = await validarEmpresaAccesible(empresa_id)
  if (!validacion.ok) return validacion

  const totales = calcularTotales(lineas, ajustes)
  const db      = createAdminClient()

  if (!factura_id_form) {
    // ── Crear ──
    if (!await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
    }
    const anio    = new Date(fecha_emision).getFullYear()
    let correlativo: number
    try {
      correlativo = await siguienteCorrelativo(db, session.client_id, empresa_id, 'FACTURA', anio)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }

    const factura_id = generarId('FAC')
    const numero     = formatoNumero('FACTURA', validacion.letra, anio, correlativo)

    const { error } = await db.from('facturas').insert({
      factura_id,
      numero,
      client_id:        session.client_id,
      empresa_id,
      cliente_id,
      fecha_emision,
      fecha_vencimiento,
      moneda,
      estado:           'BORRADOR',
      condicion_pago,
      subtotal:         totales.subtotal,
      total:            totales.total,
      notas,
      notas_internas,
    })
    if (error) return { ok: false, error: error.message }

    await escribirLineasYAjustes(db, 'FACTURA', factura_id, lineas, ajustes, totales)
    revalidatePath('/portal/ventas')
    return { ok: true, factura_id }
  }

  // ── Editar ──
  const { data: actual } = await db
    .from('facturas').select('estado, moneda')
    .eq('factura_id', factura_id_form)
    .eq('client_id', session.client_id)
    .maybeSingle()
  if (!actual)                       return { ok: false, error: 'Factura no encontrada.' }
  if (actual.estado !== 'BORRADOR')  return { ok: false, error: 'Solo se pueden editar facturas en BORRADOR.' }
  // Solo si cambia la moneda: una heredada que se desactivó no debe bloquear la edición.
  if (moneda !== actual.moneda && !await monedaValida(db, session.client_id, moneda)) {
    return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
  }

  const { error } = await db.from('facturas')
    .update({
      cliente_id, fecha_emision, fecha_vencimiento, moneda,
      condicion_pago, notas, notas_internas,
      subtotal:   totales.subtotal,
      total:      totales.total,
      updated_at: new Date().toISOString(),
    })
    .eq('factura_id', factura_id_form)
    .eq('client_id',  session.client_id)
  if (error) return { ok: false, error: error.message }

  await db.from('documento_lineas')
    .delete().eq('documento_tipo', 'FACTURA').eq('documento_id', factura_id_form)
  await db.from('documento_ajustes')
    .delete().eq('documento_tipo', 'FACTURA').eq('documento_id', factura_id_form)
  await escribirLineasYAjustes(db, 'FACTURA', factura_id_form, lineas, ajustes, totales)

  revalidatePath('/portal/ventas')
  revalidatePath(`/portal/ventas/facturas/${factura_id_form}`)
  revalidarFinanzas()
  return { ok: true, factura_id: factura_id_form }
}

// ── Helper: escribir líneas y ajustes ──────────────────────────────────────────

async function escribirLineasYAjustes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db:             any,
  documento_tipo: DocumentoTipo,
  documento_id:   string,
  lineas:         LineaInput[],
  ajustes:        AjusteInput[],
  totales:        ReturnType<typeof calcularTotales>,
): Promise<void> {
  if (lineas.length > 0) {
    await db.from('documento_lineas').insert(
      lineas.map((l, i) => ({
        documento_tipo,
        documento_id,
        orden:             i,
        producto_id:       l.producto_id,
        descripcion:       l.descripcion,
        cantidad:          l.cantidad,
        precio_unitario:   l.precio_unitario,
        descuento_pct:     l.descuento_pct ?? 0,
        descuento_importe: totales.lineas_descuentos[i] ?? 0,
        total:             totales.lineas_totales[i],
      })),
    )
  }
  if (ajustes.length > 0) {
    await db.from('documento_ajustes').insert(
      ajustes.map((a, i) => ({
        documento_tipo,
        documento_id,
        orden:           i,
        tipo:            a.tipo,
        nombre:          a.nombre,
        modo:            a.modo,
        valor:           a.valor,
        monto_calculado: totales.ajustes_calculados[i],
      })),
    )
  }
}

// ── Cambiar estado de oferta ──────────────────────────────────────────────────

export async function cambiarEstadoOferta(
  oferta_id:    string,
  nuevoEstado:  EstadoOferta,
): Promise<{ ok: boolean; error?: string; factura_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: oferta } = await db
    .from('ofertas').select('*')
    .eq('oferta_id', oferta_id)
    .eq('client_id', session.client_id)
    .maybeSingle()
  if (!oferta) return { ok: false, error: 'Oferta no encontrada.' }

  // Idempotencia
  if (oferta.estado === nuevoEstado) return { ok: true }

  const { error } = await db.from('ofertas')
    .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
    .eq('oferta_id', oferta_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  // Si pasa a APROBADA y no tiene factura, generar una automáticamente
  let factura_id: string | undefined
  if (nuevoEstado === 'APROBADA' && !oferta.factura_id) {
    const res = await convertirOfertaEnFactura(oferta_id)
    if (!res.ok) {
      // Revertir estado para evitar inconsistencia
      await db.from('ofertas')
        .update({ estado: oferta.estado })
        .eq('oferta_id', oferta_id)
      return { ok: false, error: res.error }
    }
    factura_id = res.factura_id
  }

  revalidatePath('/portal/ventas')
  revalidatePath(`/portal/ventas/ofertas/${oferta_id}`)
  return { ok: true, factura_id }
}

// ── Cambiar estado de factura ─────────────────────────────────────────────────

export async function cambiarEstadoFactura(
  factura_id:   string,
  nuevoEstado:  EstadoFactura,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: factura } = await db
    .from('facturas').select('estado')
    .eq('factura_id', factura_id)
    .eq('client_id', session.client_id)
    .maybeSingle()
  if (!factura) return { ok: false, error: 'Factura no encontrada.' }
  if (factura.estado === nuevoEstado) return { ok: true }

  // Bloquear transición EMITIDA → COBRADA: solo se cobra vía registrarPagoDoc
  if (factura.estado === 'EMITIDA' && nuevoEstado === 'COBRADA') {
    return { ok: false, error: 'Usa "Registrar cobro" en lugar de cambiar el estado directamente. Así queda el ingreso en tesorería.' }
  }

  const { error } = await db.from('facturas')
    .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
    .eq('factura_id', factura_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/ventas')
  revalidatePath(`/portal/ventas/facturas/${factura_id}`)
  revalidarFinanzas()
  return { ok: true }
}

// ── Convertir oferta APROBADA en factura BORRADOR ─────────────────────────────

export async function convertirOfertaEnFactura(
  oferta_id: string,
): Promise<{ ok: boolean; error?: string; factura_id?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: oferta } = await db
    .from('ofertas').select('*')
    .eq('oferta_id', oferta_id)
    .eq('client_id', session.client_id)
    .maybeSingle()
  if (!oferta) return { ok: false, error: 'Oferta no encontrada.' }
  if (oferta.factura_id) {
    return { ok: true, factura_id: oferta.factura_id as string }
  }

  const validacion = await validarEmpresaAccesible(oferta.empresa_id)
  if (!validacion.ok) return validacion

  const anio = new Date(oferta.fecha_emision).getFullYear()
  let correlativo: number
  try {
    correlativo = await siguienteCorrelativo(db, session.client_id, oferta.empresa_id, 'FACTURA', anio)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  const factura_id = generarId('FAC')
  const numero     = formatoNumero('FACTURA', validacion.letra, anio, correlativo)

  const { error: insErr } = await db.from('facturas').insert({
    factura_id,
    numero,
    client_id:      session.client_id,
    empresa_id:     oferta.empresa_id,
    oferta_id,
    cliente_id:     oferta.cliente_id,
    fecha_emision:  new Date().toISOString().substring(0, 10),
    moneda:         oferta.moneda,
    estado:         'BORRADOR',
    condicion_pago: oferta.condicion_pago ?? 'CONTADO',
    subtotal:       oferta.subtotal,
    total:          oferta.total,
    notas:          oferta.notas,
    notas_internas: oferta.notas_internas
      ? `Generada desde oferta ${oferta.numero}. ${oferta.notas_internas}`
      : `Generada desde oferta ${oferta.numero}`,
  })
  if (insErr) return { ok: false, error: insErr.message }

  // Copiar líneas y ajustes
  const [linRes, ajuRes] = await Promise.all([
    db.from('documento_lineas').select('*')
      .eq('documento_tipo', 'OFERTA').eq('documento_id', oferta_id).order('orden'),
    db.from('documento_ajustes').select('*')
      .eq('documento_tipo', 'OFERTA').eq('documento_id', oferta_id).order('orden'),
  ])

  if (linRes.data && linRes.data.length > 0) {
    await db.from('documento_lineas').insert(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (linRes.data as any[]).map(l => ({
        documento_tipo:    'FACTURA',
        documento_id:      factura_id,
        orden:             l.orden,
        producto_id:       l.producto_id,
        descripcion:       l.descripcion,
        cantidad:          l.cantidad,
        precio_unitario:   l.precio_unitario,
        descuento_pct:     l.descuento_pct     ?? 0,
        descuento_importe: l.descuento_importe ?? 0,
        total:             l.total,
      })),
    )
  }
  if (ajuRes.data && ajuRes.data.length > 0) {
    await db.from('documento_ajustes').insert(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ajuRes.data as any[]).map(a => ({
        documento_tipo:  'FACTURA',
        documento_id:    factura_id,
        orden:           a.orden,
        tipo:            a.tipo,
        nombre:          a.nombre,
        modo:            a.modo,
        valor:           a.valor,
        monto_calculado: a.monto_calculado,
      })),
    )
  }

  // Asociar factura a oferta
  await db.from('ofertas')
    .update({ factura_id, updated_at: new Date().toISOString() })
    .eq('oferta_id', oferta_id)

  revalidatePath('/portal/ventas')
  revalidatePath(`/portal/ventas/ofertas/${oferta_id}`)
  revalidatePath(`/portal/ventas/facturas/${factura_id}`)
  revalidarFinanzas()
  return { ok: true, factura_id }
}

// ── Duplicar oferta ───────────────────────────────────────────────────────────

export async function duplicarOferta(
  oferta_id: string,
): Promise<{ ok: boolean; error?: string; oferta_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const [ofRes, linRes, ajuRes] = await Promise.all([
    db.from('ofertas').select('*')
      .eq('oferta_id', oferta_id).eq('client_id', session.client_id).maybeSingle(),
    db.from('documento_lineas').select('*')
      .eq('documento_tipo', 'OFERTA').eq('documento_id', oferta_id).order('orden'),
    db.from('documento_ajustes').select('*')
      .eq('documento_tipo', 'OFERTA').eq('documento_id', oferta_id).order('orden'),
  ])

  const oferta = ofRes.data
  if (!oferta) return { ok: false, error: 'Oferta no encontrada.' }

  const validacion = await validarEmpresaAccesible(oferta.empresa_id)
  if (!validacion.ok) return validacion

  const hoy  = new Date().toISOString().substring(0, 10)
  const anio = new Date().getFullYear()
  let correlativo: number
  try {
    correlativo = await siguienteCorrelativo(db, session.client_id, oferta.empresa_id, 'OFERTA', anio)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  const nueva_id = generarId('OFE')
  const numero   = formatoNumero('OFERTA', validacion.letra, anio, correlativo)

  const { error } = await db.from('ofertas').insert({
    oferta_id:      nueva_id,
    numero,
    client_id:      session.client_id,
    empresa_id:     oferta.empresa_id,
    cliente_id:     oferta.cliente_id,
    fecha_emision:  hoy,
    fecha_validez:  null,
    moneda:         oferta.moneda,
    estado:         'BORRADOR',
    condicion_pago: oferta.condicion_pago ?? 'CONTADO',
    subtotal:       oferta.subtotal,
    total:          oferta.total,
    notas:          oferta.notas,
    notas_internas: `Duplicado de ${oferta.numero} — ${hoy}`,
  })
  if (error) return { ok: false, error: error.message }

  // Copiar líneas
  if (linRes.data && linRes.data.length > 0) {
    await db.from('documento_lineas').insert(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (linRes.data as any[]).map(l => ({
        documento_tipo:    'OFERTA',
        documento_id:      nueva_id,
        orden:             l.orden,
        producto_id:       l.producto_id,
        descripcion:       l.descripcion,
        cantidad:          l.cantidad,
        precio_unitario:   l.precio_unitario,
        descuento_pct:     l.descuento_pct     ?? 0,
        descuento_importe: l.descuento_importe ?? 0,
        total:             l.total,
      })),
    )
  }
  // Copiar ajustes
  if (ajuRes.data && ajuRes.data.length > 0) {
    await db.from('documento_ajustes').insert(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ajuRes.data as any[]).map(a => ({
        documento_tipo:  'OFERTA',
        documento_id:    nueva_id,
        orden:           a.orden,
        tipo:            a.tipo,
        nombre:          a.nombre,
        modo:            a.modo,
        valor:           a.valor,
        monto_calculado: a.monto_calculado,
      })),
    )
  }

  revalidatePath('/portal/ventas')
  return { ok: true, oferta_id: nueva_id }
}

// ── Duplicar factura ──────────────────────────────────────────────────────────

export async function duplicarFactura(
  factura_id: string,
): Promise<{ ok: boolean; error?: string; factura_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const [faRes, linRes, ajuRes] = await Promise.all([
    db.from('facturas').select('*')
      .eq('factura_id', factura_id).eq('client_id', session.client_id).maybeSingle(),
    db.from('documento_lineas').select('*')
      .eq('documento_tipo', 'FACTURA').eq('documento_id', factura_id).order('orden'),
    db.from('documento_ajustes').select('*')
      .eq('documento_tipo', 'FACTURA').eq('documento_id', factura_id).order('orden'),
  ])

  const factura = faRes.data
  if (!factura) return { ok: false, error: 'Factura no encontrada.' }

  const validacion = await validarEmpresaAccesible(factura.empresa_id)
  if (!validacion.ok) return validacion

  const hoy  = new Date().toISOString().substring(0, 10)
  const anio = new Date().getFullYear()
  let correlativo: number
  try {
    correlativo = await siguienteCorrelativo(db, session.client_id, factura.empresa_id, 'FACTURA', anio)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  const nueva_id = generarId('FAC')
  const numero   = formatoNumero('FACTURA', validacion.letra, anio, correlativo)

  // Calcular vencimiento desde condicion_pago
  const condicion = factura.condicion_pago ?? 'CONTADO'
  let fecha_vencimiento: string | null = null
  if (condicion !== 'CONTADO') {
    const dias = parseInt(condicion) || 0
    const d    = new Date(hoy)
    d.setDate(d.getDate() + dias)
    fecha_vencimiento = d.toISOString().substring(0, 10)
  }

  const { error } = await db.from('facturas').insert({
    factura_id:       nueva_id,
    numero,
    client_id:        session.client_id,
    empresa_id:       factura.empresa_id,
    oferta_id:        null,
    cliente_id:       factura.cliente_id,
    fecha_emision:    hoy,
    fecha_vencimiento,
    moneda:           factura.moneda,
    estado:           'BORRADOR',
    condicion_pago:   condicion,
    subtotal:         factura.subtotal,
    total:            factura.total,
    notas:            factura.notas,
    notas_internas:   `Duplicado de ${factura.numero} — ${hoy}`,
  })
  if (error) return { ok: false, error: error.message }

  if (linRes.data && linRes.data.length > 0) {
    await db.from('documento_lineas').insert(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (linRes.data as any[]).map(l => ({
        documento_tipo:    'FACTURA',
        documento_id:      nueva_id,
        orden:             l.orden,
        producto_id:       l.producto_id,
        descripcion:       l.descripcion,
        cantidad:          l.cantidad,
        precio_unitario:   l.precio_unitario,
        descuento_pct:     l.descuento_pct     ?? 0,
        descuento_importe: l.descuento_importe ?? 0,
        total:             l.total,
      })),
    )
  }
  if (ajuRes.data && ajuRes.data.length > 0) {
    await db.from('documento_ajustes').insert(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ajuRes.data as any[]).map(a => ({
        documento_tipo:  'FACTURA',
        documento_id:    nueva_id,
        orden:           a.orden,
        tipo:            a.tipo,
        nombre:          a.nombre,
        modo:            a.modo,
        valor:           a.valor,
        monto_calculado: a.monto_calculado,
      })),
    )
  }

  revalidatePath('/portal/ventas')
  revalidarFinanzas()
  return { ok: true, factura_id: nueva_id }
}

// ── Acciones en lote ──────────────────────────────────────────────────────────
//
// Reutilizan las acciones individuales (misma validación de gating, dueño,
// transición y efectos secundarios: aprobar genera factura, etc.). La capa de
// lote solo decide la ELEGIBILIDAD por estado — aplica a las válidas y reporta
// las omitidas con su número y motivo — y, en duplicar, fuerza el orden
// SECUENCIAL para que el correlativo (read-modify-write, no atómico) no colisione.

export interface ResultadoLote {
  hechas:   number
  omitidas: { numero: string; motivo: string }[]
  errores:  { numero: string; error: string }[]
  error?:   string   // fallo global (sesión / permiso / destino no válido)
}

// Estados desde los que es válido cada estado destino en lote.
const DESDE_OFERTA: Record<EstadoOferta, EstadoOferta[]> = {
  BORRADOR:  [],                        // no es destino de lote
  ENVIADA:   ['BORRADOR'],
  APROBADA:  ['BORRADOR', 'ENVIADA'],
  RECHAZADA: ['BORRADOR', 'ENVIADA'],
  CADUCADA:  ['BORRADOR', 'ENVIADA'],
}
const DESDE_FACTURA: Record<EstadoFactura, EstadoFactura[]> = {
  BORRADOR: [],
  EMITIDA:  ['BORRADOR'],
  COBRADA:  [],                         // cobrar va por registrarPagoDoc
  ANULADA:  ['BORRADOR', 'EMITIDA'],
}
const OFERTA_ELIMINABLE:  EstadoOferta[]  = ['BORRADOR', 'RECHAZADA', 'CADUCADA']
const FACTURA_ELIMINABLE: EstadoFactura[] = ['BORRADOR']

function loteVacio(error?: string): ResultadoLote {
  return { hechas: 0, omitidas: [], errores: [], error }
}

async function guardaLote(): Promise<{ session: NonNullable<Awaited<ReturnType<typeof getPortalSession>>> } | { error: string }> {
  const session = await getPortalSession()
  if (!session) return { error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { error: 'No tienes permiso para editar en este módulo.' }
  return { session }
}

// ── Cambiar estado en lote ────────────────────────────────────────────────────

export async function cambiarEstadoOfertasEnLote(
  ids: string[], nuevoEstado: EstadoOferta,
): Promise<ResultadoLote> {
  const g = await guardaLote()
  if ('error' in g) return loteVacio(g.error)
  const validos = DESDE_OFERTA[nuevoEstado]
  if (!validos.length) return loteVacio('Estado destino no válido para lote.')

  const db = createAdminClient()
  const { data: docs } = await db.from('ofertas')
    .select('oferta_id, numero, estado')
    .eq('client_id', g.session.client_id).in('oferta_id', ids)

  const res = loteVacio()
  for (const d of (docs ?? []) as { oferta_id: string; numero: string; estado: EstadoOferta }[]) {
    if (d.estado === nuevoEstado) { res.omitidas.push({ numero: d.numero, motivo: 'ya estaba en ese estado' }); continue }
    if (!validos.includes(d.estado)) {
      res.omitidas.push({ numero: d.numero, motivo: `no se puede desde ${ESTADO_OFERTA_LABEL[d.estado]}` }); continue
    }
    const r = await cambiarEstadoOferta(d.oferta_id, nuevoEstado)
    if (r.ok) res.hechas++
    else res.errores.push({ numero: d.numero, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/ventas')
  return res
}

export async function cambiarEstadoFacturasEnLote(
  ids: string[], nuevoEstado: EstadoFactura,
): Promise<ResultadoLote> {
  const g = await guardaLote()
  if ('error' in g) return loteVacio(g.error)
  const validos = DESDE_FACTURA[nuevoEstado]
  if (!validos.length) return loteVacio('Estado destino no válido para lote.')

  const db = createAdminClient()
  const { data: docs } = await db.from('facturas')
    .select('factura_id, numero, estado')
    .eq('client_id', g.session.client_id).in('factura_id', ids)

  const res = loteVacio()
  for (const d of (docs ?? []) as { factura_id: string; numero: string; estado: EstadoFactura }[]) {
    if (d.estado === nuevoEstado) { res.omitidas.push({ numero: d.numero, motivo: 'ya estaba en ese estado' }); continue }
    if (!validos.includes(d.estado)) {
      res.omitidas.push({ numero: d.numero, motivo: `no se puede desde ${ESTADO_FACTURA_LABEL[d.estado]}` }); continue
    }
    const r = await cambiarEstadoFactura(d.factura_id, nuevoEstado)
    if (r.ok) res.hechas++
    else res.errores.push({ numero: d.numero, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/ventas')
  revalidarFinanzas()
  return res
}

// ── Duplicar en lote (SECUENCIAL: correlativos sin colisión) ──────────────────

export async function duplicarOfertasEnLote(
  ids: string[],
): Promise<ResultadoLote & { ids: string[] }> {
  const g = await guardaLote()
  if ('error' in g) return { ...loteVacio(g.error), ids: [] }

  const db = createAdminClient()
  const { data: docs } = await db.from('ofertas')
    .select('oferta_id, numero').eq('client_id', g.session.client_id).in('oferta_id', ids)
  const numeroDe = new Map((docs ?? []).map((d: { oferta_id: string; numero: string }) => [d.oferta_id, d.numero]))

  const res: ResultadoLote & { ids: string[] } = { ...loteVacio(), ids: [] }
  for (const id of ids) {
    if (!numeroDe.has(id)) continue
    const r = await duplicarOferta(id)   // secuencial a propósito
    if (r.ok && r.oferta_id) { res.hechas++; res.ids.push(r.oferta_id) }
    else res.errores.push({ numero: numeroDe.get(id) ?? id, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/ventas')
  return res
}

export async function duplicarFacturasEnLote(
  ids: string[],
): Promise<ResultadoLote & { ids: string[] }> {
  const g = await guardaLote()
  if ('error' in g) return { ...loteVacio(g.error), ids: [] }

  const db = createAdminClient()
  const { data: docs } = await db.from('facturas')
    .select('factura_id, numero').eq('client_id', g.session.client_id).in('factura_id', ids)
  const numeroDe = new Map((docs ?? []).map((d: { factura_id: string; numero: string }) => [d.factura_id, d.numero]))

  const res: ResultadoLote & { ids: string[] } = { ...loteVacio(), ids: [] }
  for (const id of ids) {
    if (!numeroDe.has(id)) continue
    const r = await duplicarFactura(id)  // secuencial a propósito
    if (r.ok && r.factura_id) { res.hechas++; res.ids.push(r.factura_id) }
    else res.errores.push({ numero: numeroDe.get(id) ?? id, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/ventas')
  return res
}

// ── Archivar / desarchivar en lote (soft, cualquier estado) ───────────────────

// Candado inline (no vía helper) en las que ESCRIBEN directo, para que el
// audit-gating lo vea: puedeEditarModulo('base') es el módulo de ventas.
export async function archivarOfertasEnLote(
  ids: string[], archivar: boolean,
): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session) return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('base'))) return loteVacio('No tienes permiso para editar en este módulo.')

  const db = createAdminClient()
  const { data, error } = await db.from('ofertas')
    .update({ archivado: archivar, updated_at: new Date().toISOString() })
    .eq('client_id', session.client_id).in('oferta_id', ids)
    .select('oferta_id')
  if (error) return loteVacio(error.message)
  revalidatePath('/portal/ventas')
  return { ...loteVacio(), hechas: (data ?? []).length }
}

export async function archivarFacturasEnLote(
  ids: string[], archivar: boolean,
): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session) return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('base'))) return loteVacio('No tienes permiso para editar en este módulo.')

  const db = createAdminClient()
  const { data, error } = await db.from('facturas')
    .update({ archivado: archivar, updated_at: new Date().toISOString() })
    .eq('client_id', session.client_id).in('factura_id', ids)
    .select('factura_id')
  if (error) return loteVacio(error.message)
  revalidatePath('/portal/ventas')
  return { ...loteVacio(), hechas: (data ?? []).length }
}

// ── Eliminar en lote (borrado real, con guardas de estado) ────────────────────

export async function eliminarOfertasEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session) return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('base'))) return loteVacio('No tienes permiso para editar en este módulo.')

  const db = createAdminClient()
  const { data: docs } = await db.from('ofertas')
    .select('oferta_id, numero, estado, factura_id')
    .eq('client_id', session.client_id).in('oferta_id', ids)

  const res = loteVacio()
  const borrables: string[] = []
  for (const d of (docs ?? []) as { oferta_id: string; numero: string; estado: EstadoOferta; factura_id: string | null }[]) {
    if (d.factura_id) { res.omitidas.push({ numero: d.numero, motivo: 'tiene factura asociada' }); continue }
    if (!OFERTA_ELIMINABLE.includes(d.estado)) {
      res.omitidas.push({ numero: d.numero, motivo: `no se elimina en estado ${ESTADO_OFERTA_LABEL[d.estado]}` }); continue
    }
    borrables.push(d.oferta_id)
  }
  if (borrables.length) {
    await db.from('documento_lineas').delete().eq('documento_tipo', 'OFERTA').in('documento_id', borrables)
    await db.from('documento_ajustes').delete().eq('documento_tipo', 'OFERTA').in('documento_id', borrables)
    const { error } = await db.from('ofertas').delete()
      .eq('client_id', session.client_id).in('oferta_id', borrables)
    if (error) res.errores.push({ numero: '—', error: error.message })
    else res.hechas = borrables.length
  }
  revalidatePath('/portal/ventas')
  return res
}

export async function eliminarFacturasEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session) return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('base'))) return loteVacio('No tienes permiso para editar en este módulo.')

  const db = createAdminClient()
  const { data: docs } = await db.from('facturas')
    .select('factura_id, numero, estado')
    .eq('client_id', session.client_id).in('factura_id', ids)

  const res = loteVacio()
  const borrables: string[] = []
  for (const d of (docs ?? []) as { factura_id: string; numero: string; estado: EstadoFactura }[]) {
    if (!FACTURA_ELIMINABLE.includes(d.estado)) {
      res.omitidas.push({ numero: d.numero, motivo: `no se elimina en estado ${ESTADO_FACTURA_LABEL[d.estado]} (anúlala)` }); continue
    }
    borrables.push(d.factura_id)
  }
  if (borrables.length) {
    // Una factura BORRADOR puede venir de una oferta aprobada: soltar el enlace
    // para no dejar la oferta apuntando a una factura inexistente.
    await db.from('ofertas').update({ factura_id: null })
      .eq('client_id', session.client_id).in('factura_id', borrables)
    await db.from('documento_lineas').delete().eq('documento_tipo', 'FACTURA').in('documento_id', borrables)
    await db.from('documento_ajustes').delete().eq('documento_tipo', 'FACTURA').in('documento_id', borrables)
    const { error } = await db.from('facturas').delete()
      .eq('client_id', session.client_id).in('factura_id', borrables)
    if (error) res.errores.push({ numero: '—', error: error.message })
    else res.hechas = borrables.length
  }
  revalidatePath('/portal/ventas')
  revalidarFinanzas()
  return res
}
