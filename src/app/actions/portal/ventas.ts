'use server'

import { revalidatePath }    from 'next/cache'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { tieneAlgunModulo, tieneModulo, MODULOS_CATALOGO } from '@/lib/modulos'
import { monedaValida, mapaTasas } from '@/lib/tasas'
import { sumarPeriodo, restarPeriodo, type PeriodicidadSub } from '@/lib/suscripciones'
// Núcleo sin sesión, compartido con el cron de facturación automática. Ver el porqué
// de que viva fuera de este fichero en `lib/ventas/factura-core.ts`.
import {
  generarIdDocumento, siguienteCorrelativo, escribirLineasYAjustes, fotoDeCostes,
} from '@/lib/ventas/factura-core'
import { aplicarMovimiento } from './_inventario-helpers'
import { estadoCobro } from '@/lib/cobranza-core'
import {
  limiteDelFiltro, importeBuscado, patronBusqueda, rangoUltimosMeses,
  type FiltroListado as _FiltroListado,
} from '@/lib/listados'
import {
  calcularTotales,
  formatoNumero,
  numeroProvisional,
  esNumeroProvisional,
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

// El tipo se re-declara (no `export type { … } from`, que rompe el loader de
// 'use server'): las vistas necesitan nombrarlo para pasar los filtros.
export type FiltroListado = _FiltroListado

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
  /** Si al emitir se saca del inventario lo vendido (mig. 150). Elección por factura. */
  descuenta_stock:   boolean
  /** Almacén del que sale la mercancía. Null si no descuenta o si aún no se eligió. */
  almacen_id:        string | null
  /** Rastro mínimo (mig. 151): email y momento de las dos transiciones que importan. */
  emitida_por:       string | null
  emitida_at:        string | null
  anulada_por:       string | null
  anulada_at:        string | null
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
  /** Unidad congelada en el documento (mig. 151); null en las líneas anteriores. */
  unidad:            string | null
  /** Suscripción que generó la línea (facturación del período). Rastro de idempotencia. */
  suscripcion_id:    string | null
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

export interface ProductoOpcion {
  producto_id: string
  codigo:      string
  nombre:      string
  unidad:      string
  precios:     Record<string, number>
  /** PRODUCTO (físico, mueve existencias) | SERVICIO. Solo el físico se descuenta. */
  tipo:        string
  /** Existencias por almacén. Sirve para AVISAR en la línea, no para bloquear. */
  stock:       Record<string, number>
}

/** Factura del listado + su estado de cobro, calculado en servidor (B2). */
export interface FacturaListado extends Factura {
  /** Cobrado en la moneda de la factura. */
  liquidado:    number
  saldo:        number
  /** Hay cobros pero queda saldo. Derivado: el estado persistido sigue siendo EMITIDA. */
  parcial:      boolean
  /** Días de retraso si hay saldo vencido; null si está al día, cobrada o sin plazo. */
  dias_vencido: number | null
}

export interface VentasResumenData {
  ofertas:           Oferta[]
  facturas:          FacturaListado[]
  empresas:          { empresa_id: string; nombre: string; letra_facturacion: string | null }[]
  empresa_nombres:   Record<string, string>
  clientes:          { tercero_id: string; nombre: string; empresa_id: string; moneda_defecto: string | null; identificacion: string | null; direccion: string | null; ciudad: string | null; pais: string | null; email: string | null; telefono: string | null }[]
  cliente_nombres:   Record<string, string>
  monedas:           string[]
  /** Rango realmente aplicado (viaja a la UI para que las píldoras y la URL no mientan). */
  rango:             { desde: string; hasta: string }
  q:                 string
  /** Se alcanzó el techo de filas: hay más documentos fuera de la vista. */
  hay_mas_ofertas:   boolean
  hay_mas_facturas:  boolean
}

/**
 * Todo lo que necesita el FORMULARIO de un documento (factura u oferta), y nada más.
 *
 * Antes las cuatro pantallas de alta/edición llamaban a `obtenerVentasResumen`, que
 * descarga **todas** las ofertas y **todas** las facturas del negocio para no usar
 * ninguna: con dos años de histórico, crear una factura se traía miles de filas.
 * Aquí no hay documentos, solo catálogos.
 */
export interface ContextoDocumentoData {
  empresas:       VentasResumenData['empresas']
  clientes:       VentasResumenData['clientes']
  productos:      ProductoOpcion[]
  monedas:        string[]
  /** "ORIGEN__DESTINO" → factor. Para convertir los importes al cambiar la moneda
   *  del documento sin ida y vuelta al servidor (ver `mapaTasas`). */
  tasas:          Record<string, number>
  /** Almacenes activos: de dónde puede salir la mercancía al emitir (mig. 150). */
  almacenes:      { almacen_id: string; nombre: string; empresa_id: string }[]
  /** Sin el módulo Inventario el bloque de descuento de stock no existe. */
  hay_inventario: boolean
}

export interface OfertaDetalleData {
  oferta:   Oferta
  empresa:  { empresa_id: string; nombre: string; nombre_fiscal: string | null; rif_nit: string | null; direccion: string | null; ciudad: string | null; pais: string | null; telefono: string | null; email: string | null; logo_url: string | null; mostrar_logo: boolean | null; letra_facturacion: string | null; color: string; datos_pago: string | null; pie_factura: string | null }
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
  /** Nombre del almacén de `facturas.almacen_id`, para la ficha (mig. 150). */
  almacen_nombre?: string | null
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function parseJSON<T>(s: FormDataEntryValue | null, fallback: T): T {
  if (!s || typeof s !== 'string') return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

/** La empresa es del cliente de la sesión y puede facturar (tiene letra). */
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

type FilaCliente = {
  tercero_id: string; nombre: string; empresa_id: string; moneda_defecto: string | null
  identificacion: string | null; direccion: string | null; ciudad: string | null
  pais: string | null; email: string | null; telefono: string | null
}

/** Clientes de las empresas accesibles. Los usan el listado y el formulario. */
async function clientesFacturables(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, client_id: string, empresa_ids: string[],
): Promise<FilaCliente[]> {
  const { data } = await db.from('third_parties')
    .select('tercero_id, nombre, empresa_id, moneda_defecto, identificacion, direccion, ciudad, pais, email, telefono')
    .eq('client_id', client_id)
    .in('empresa_id', empresa_ids)
    .in('tipo', ['CLIENTE', 'AMBOS'])
    .eq('activo', true)
    .order('nombre')
  return (data ?? []) as FilaCliente[]
}

export async function obtenerVentasResumen(
  filtro?: FiltroListado,
): Promise<VentasResumenData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db       = createAdminClient()
  const empresas = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)

  // Por defecto, los últimos 3 meses. **En la query, no en el cliente**: antes se traían
  // todas las ofertas y todas las facturas del negocio y se filtraba en memoria.
  const porDefecto = rangoUltimosMeses(3)
  const desde = filtro?.desde ?? porDefecto.desde
  const hasta = filtro?.hasta ?? porDefecto.hasta
  const q     = (filtro?.q ?? '').trim()
  const limite = limiteDelFiltro(filtro)
  const rango = { desde, hasta }

  if (!empresa_ids.length) {
    return {
      ofertas: [], facturas: [],
      empresas: [], empresa_nombres: {},
      clientes: [], cliente_nombres: {},
      monedas: [], rango, q, hay_mas_ofertas: false, hay_mas_facturas: false,
    }
  }

  const patron  = patronBusqueda(q)
  const importe = importeBuscado(q)
  const clientes = await clientesFacturables(db, session.client_id, empresa_ids)

  // El texto también busca por CLIENTE, y el cliente es otra tabla: se resuelven sus ids
  // aquí, con la lista que ya está cargada, en vez de pedirle a Postgres un join que
  // PostgREST no expresa cómodamente en un `.or()`.
  const idsClienteQ = patron
    ? clientes.filter(c => c.nombre.toLowerCase().includes(q.toLowerCase())).map(c => c.tercero_id)
    : []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conFiltros = (query: any, campoFecha: string, campoNumero: string) => {
    let out = query.eq('client_id', session.client_id).in('empresa_id', empresa_ids)
    if (desde) out = out.gte(campoFecha, desde)
    if (hasta) out = out.lte(campoFecha, hasta)
    if (patron) {
      const partes = [`${campoNumero}.ilike.${patron}`]
      if (idsClienteQ.length) partes.push(`cliente_id.in.(${idsClienteQ.join(',')})`)
      if (importe != null)    partes.push(`total.eq.${importe}`)
      out = out.or(partes.join(','))
    }
    return out.order(campoFecha, { ascending: false }).order('created_at', { ascending: false }).limit(limite)
  }

  const [ofRes, faRes, monRes] = await Promise.all([
    conFiltros(db.from('ofertas').select('*'),  'fecha_emision', 'numero'),
    conFiltros(db.from('facturas').select('*'), 'fecha_emision', 'numero'),
    db.from('monedas')
      .select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('codigo'),
  ])

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  const cliente_nombres: Record<string, string> = {}
  for (const c of clientes) cliente_nombres[c.tercero_id] = c.nombre

  // ── Estado de cobro de las facturas del rango (B2) ──
  // Antes había que salir a CxC para saber si una factura estaba cobrada. Los cobros se
  // leen SIN filtro de fecha —una factura de julio cobrada en agosto ya no se debe— pero
  // solo de los documentos del rango, que es lo que evita traer el histórico entero.
  const facturasRaw = (faRes.data ?? []) as Factura[]
  const liquidado = new Map<string, number>()
  if (facturasRaw.length) {
    const { data: liqs } = await db.from('movimientos_tesoreria')
      .select('referencia_id, monto, monto_ref')
      .eq('client_id', session.client_id)
      .eq('origen', 'COBRO')
      .in('referencia_id', facturasRaw.map(f => f.factura_id))
    for (const m of ((liqs ?? []) as { referencia_id: string; monto: number; monto_ref: number | null }[])) {
      liquidado.set(m.referencia_id, (liquidado.get(m.referencia_id) ?? 0) + Number(m.monto_ref ?? m.monto))
    }
  }
  const hoy = new Date().toISOString().split('T')[0]
  const facturas: FacturaListado[] = facturasRaw.map(f => {
    // Una anulada no debe nada: su saldo no es deuda, es un documento invalidado.
    if (f.estado === 'ANULADA' || f.estado === 'BORRADOR') {
      return { ...f, liquidado: 0, saldo: 0, parcial: false, dias_vencido: null }
    }
    const e = estadoCobro(Number(f.total), liquidado.get(f.factura_id) ?? 0, f.fecha_vencimiento, hoy)
    return { ...f, liquidado: e.liquidado, saldo: e.saldo, parcial: e.parcial, dias_vencido: e.dias_vencido }
  })

  return {
    ofertas:          (ofRes.data ?? []) as Oferta[],
    facturas,
    empresas:         empresas.map(e => ({
                        empresa_id:        e.empresa_id,
                        nombre:            e.nombre,
                        letra_facturacion: e.letra_facturacion,
                      })),
    empresa_nombres,
    clientes,
    cliente_nombres,
    monedas:          ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo),
    rango,
    q,
    hay_mas_ofertas:  (ofRes.data ?? []).length >= limite,
    hay_mas_facturas: facturasRaw.length >= limite,
  }
}

// ── Contexto del formulario de un documento (C2) ───────────────────────────────

export async function obtenerContextoDocumento(): Promise<ContextoDocumentoData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db       = createAdminClient()
  const empresas = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const vacio: ContextoDocumentoData = {
    empresas: [], clientes: [], productos: [], monedas: [], tasas: {},
    almacenes: [], hay_inventario: false,
  }
  if (!empresa_ids.length) return vacio

  // Gate por la lista de artículos (Inventario O la pieza Servicios): el selector es
  // una conveniencia de llenado rápido. Sin ninguna de las dos, las líneas se
  // rellenan con texto libre (la base funciona sola); con cualquiera, se ofrece el
  // catálogo. Es EL punto de la pieza Servicios: que una consultora tenga sus
  // servicios en las facturas sin pagar almacenes que no usa.
  const { data: clienteRow } = await db
    .from('clients')
    .select('modulos_activos')
    .eq('client_id', session.client_id)
    .single()
  const tieneCatalogo  = tieneAlgunModulo(clienteRow?.modulos_activos, MODULOS_CATALOGO)
  const hay_inventario = tieneModulo(clienteRow?.modulos_activos, 'inventario')

  const [clientes, prodRes, monRes, almRes, stockRes] = await Promise.all([
    clientesFacturables(db, session.client_id, empresa_ids),
    tieneCatalogo
      ? db.from('products')
          .select('producto_id, codigo, nombre, unidad, precios, tipo')
          .eq('client_id', session.client_id)
          .eq('estado', 'ACTIVO')
          .order('nombre')
      : Promise.resolve({ data: [] }),
    db.from('monedas')
      .select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('codigo'),
    hay_inventario
      ? db.from('almacenes')
          .select('almacen_id, nombre, empresa_id')
          .eq('client_id', session.client_id)
          .in('empresa_id', empresa_ids)
          .eq('activo', true)
          .order('nombre')
      : Promise.resolve({ data: [] }),
    // Existencias por (producto, almacén). Solo para AVISAR en la línea: facturar es
    // un hecho comercial y un stock mal cuadrado no puede impedir emitir. Se trae con
    // la página porque preguntarlo por línea sería un viaje por tecla en 3G.
    hay_inventario
      ? db.from('stock_almacenes')
          .select('producto_id, almacen_id, cantidad')
          .eq('client_id', session.client_id)
      : Promise.resolve({ data: [] }),
  ])

  const stockPorProducto = new Map<string, Record<string, number>>()
  for (const s of ((stockRes.data ?? []) as { producto_id: string; almacen_id: string; cantidad: number }[])) {
    const m = stockPorProducto.get(s.producto_id) ?? {}
    m[s.almacen_id] = Number(s.cantidad)
    stockPorProducto.set(s.producto_id, m)
  }

  // Tasas entre las monedas del cliente: viajan con la página para que cambiar la
  // moneda del documento pueda reexpresar los importes en el acto. Son 2-4 monedas,
  // un puñado de pares. Un par sin tasa NO aparece en el mapa: la UI lo interpreta
  // como "no cotiza" y deja los importes intactos en vez de inventarse un factor.
  const codigosMoneda = ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo)
  const tasas = await mapaTasas(db, session.client_id, codigosMoneda)

  type FilaProd = { producto_id: string; codigo: string; nombre: string; unidad: string; precios: Record<string, number> | null; tipo: string | null }
  return {
    empresas:  empresas.map(e => ({
                 empresa_id:        e.empresa_id,
                 nombre:            e.nombre,
                 letra_facturacion: e.letra_facturacion,
               })),
    clientes,
    productos: ((prodRes.data ?? []) as FilaProd[]).map(p => ({
                 producto_id: p.producto_id,
                 codigo:      p.codigo,
                 nombre:      p.nombre,
                 unidad:      p.unidad,
                 precios:     p.precios ?? {},
                 tipo:        p.tipo ?? 'PRODUCTO',
                 stock:       stockPorProducto.get(p.producto_id) ?? {},
               })),
    monedas:   codigosMoneda,
    tasas,
    almacenes: (almRes.data ?? []) as ContextoDocumentoData['almacenes'],
    hay_inventario,
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
      .select('empresa_id, nombre, nombre_fiscal, rif_nit, direccion, ciudad, pais, telefono, email, logo_url, mostrar_logo, letra_facturacion, color, datos_pago, pie_factura')
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
  const [empRes, cliRes, linRes, ajuRes, ofeRes, almRes] = await Promise.all([
    db.from('empresas')
      .select('empresa_id, nombre, nombre_fiscal, rif_nit, direccion, ciudad, pais, telefono, email, logo_url, mostrar_logo, letra_facturacion, color, datos_pago, pie_factura')
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
    // El nombre del almacén, para que la ficha diga de DÓNDE salió la mercancía y no
    // un `ALM-` que no significa nada para el dueño.
    factura.almacen_id
      ? db.from('almacenes').select('nombre').eq('almacen_id', factura.almacen_id)
          .eq('client_id', session.client_id).maybeSingle()
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
    almacen_nombre: (almRes.data as { nombre: string } | null)?.nombre ?? null,
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

    const oferta_id = generarIdDocumento('OFE')
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

    await escribirLineasYAjustes(db, 'OFERTA', oferta_id, lineas, ajustes, totales, session.client_id, moneda)
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
  await escribirLineasYAjustes(db, 'OFERTA', oferta_id_form, lineas, ajustes, totales, session.client_id, moneda)

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
  // Un vencimiento anterior a la emisión nace vencido: CxC lo pinta en rojo el mismo día
  // que se crea y el aviso de cobro sale antes de que exista la deuda.
  if (fecha_vencimiento && fecha_vencimiento < fecha_emision) {
    return { ok: false, error: 'El vencimiento no puede ser anterior a la fecha de emisión.' }
  }

  const lineas  = parseJSON<LineaInput[]>(formData.get('lineas'),  [])
  const ajustes = parseJSON<AjusteInput[]>(formData.get('ajustes'), [])
  if (lineas.length === 0) return { ok: false, error: 'Añade al menos una línea.' }

  const validacion = await validarEmpresaAccesible(empresa_id)
  if (!validacion.ok) return validacion

  const totales = calcularTotales(lineas, ajustes)
  const db      = createAdminClient()

  // ── Descuento de inventario (mig. 150): elección por factura, no automatismo ──
  // El check del formulario no basta: se revalidan el módulo y el almacén en servidor
  // (la UI oculta no es control de acceso). Sin almacén válido no se descuenta, en vez
  // de emitir y fallar al mover existencias con el número fiscal ya gastado.
  let descuenta_stock = false
  let almacen_id: string | null = null
  if (formData.get('descuenta_stock') === '1') {
    const almacenForm = (formData.get('almacen_id') as string)?.trim() || ''
    const { data: cli } = await db.from('clients')
      .select('modulos_activos').eq('client_id', session.client_id).maybeSingle()
    if (tieneModulo(cli?.modulos_activos, 'inventario')) {
      if (!almacenForm) return { ok: false, error: 'Elige el almacén del que sale la mercancía.' }
      const { data: alm } = await db.from('almacenes')
        .select('almacen_id').eq('client_id', session.client_id)
        .eq('almacen_id', almacenForm).eq('activo', true).maybeSingle()
      if (!alm) return { ok: false, error: 'El almacén elegido no existe o está inactivo.' }
      descuenta_stock = true
      almacen_id      = almacenForm
    }
  }

  if (!factura_id_form) {
    // ── Crear ──
    if (!await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
    }
    // Sin número fiscal hasta que se emita (§`numeroProvisional`).
    const factura_id = generarIdDocumento('FAC')
    const numero     = numeroProvisional(factura_id)

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
      descuenta_stock,
      almacen_id,
    })
    if (error) return { ok: false, error: error.message }

    await escribirLineasYAjustes(db, 'FACTURA', factura_id, lineas, ajustes, totales, session.client_id, moneda)
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
      // Editar un BORRADOR no mueve existencias (eso pasa al emitir): aquí solo se
      // guarda la intención.
      descuenta_stock, almacen_id,
      updated_at: new Date().toISOString(),
    })
    .eq('factura_id', factura_id_form)
    .eq('client_id',  session.client_id)
  if (error) return { ok: false, error: error.message }

  await db.from('documento_lineas')
    .delete().eq('documento_tipo', 'FACTURA').eq('documento_id', factura_id_form)
  await db.from('documento_ajustes')
    .delete().eq('documento_tipo', 'FACTURA').eq('documento_id', factura_id_form)
  await escribirLineasYAjustes(db, 'FACTURA', factura_id_form, lineas, ajustes, totales, session.client_id, moneda)

  revalidatePath('/portal/ventas')
  revalidatePath(`/portal/ventas/facturas/${factura_id_form}`)
  revalidarFinanzas()
  return { ok: true, factura_id: factura_id_form }
}

// ── Helper: escribir líneas y ajustes ──────────────────────────────────────────

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

// ── Existencias de una factura (mig. 150) ─────────────────────────────────────
//
// Al EMITIR se saca del almacén lo vendido; al ANULAR se devuelve. Dos reglas que no
// son negociables y conviene tener escritas, porque las dos se «arreglan» mal:
//
//  1. **La idempotencia se pregunta a los movimientos, no a un flag.** Un flag en la
//     factura se puede quedar escrito con el movimiento a medias (es exactamente el
//     fallo que `lib/caja/ingesta.ts` sufrió y documenta). Con el ledger delante,
//     emitir → anular → emitir no duplica ni pierde nada.
//  2. **`permitir_negativo: true`.** La venta ya ocurrió: el documento es un hecho
//     comercial. Un stock mal cuadrado no puede impedir facturar — que es también el
//     criterio del cierre de caja. El aviso va en el formulario, antes.
//
// Y los FÍSICOS se filtran ANTES de llamar a la RPC, sin confiar en que la base lo
// pare: con `permitir_negativo` no lo pararía, crearía stock negativo de un `SRV-` en
// silencio (mismo filtro que `ingesta.ts`).
async function moverStockFactura(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, client_id: string, factura_id: string, direccion: 'SALIDA' | 'ENTRADA',
): Promise<void> {
  const { data: fac } = await db.from('facturas')
    .select('empresa_id, numero, fecha_emision, descuenta_stock, almacen_id')
    .eq('factura_id', factura_id).eq('client_id', client_id).maybeSingle()
  if (!fac?.descuenta_stock || !fac.almacen_id) return

  const { data: previos } = await db.from('movimientos_inventario')
    .select('tipo')
    .eq('client_id', client_id).eq('origen', 'VENTA').eq('referencia_id', factura_id)
  const hechos = (previos ?? []) as { tipo: string }[]
  const salidas  = hechos.filter(m => m.tipo === 'SALIDA').length
  const entradas = hechos.filter(m => m.tipo === 'ENTRADA').length
  // SALIDA solo si no hay ninguna viva; ENTRADA solo si queda algo que devolver.
  if (direccion === 'SALIDA'  && salidas > entradas) return
  if (direccion === 'ENTRADA' && salidas <= entradas) return

  const { data: lineas } = await db.from('documento_lineas')
    .select('producto_id, cantidad')
    .eq('documento_tipo', 'FACTURA').eq('documento_id', factura_id)
    .not('producto_id', 'is', null)
  type Lin = { producto_id: string; cantidad: number }
  const ids = [...new Set(((lineas ?? []) as Lin[]).map(l => l.producto_id))]
  if (!ids.length) return

  const { data: prods } = await db.from('products')
    .select('producto_id').eq('client_id', client_id).in('producto_id', ids).eq('tipo', 'PRODUCTO')
  const fisicos = new Set(((prods ?? []) as { producto_id: string }[]).map(p => p.producto_id))

  const porProducto = new Map<string, number>()
  for (const l of ((lineas ?? []) as Lin[])) {
    if (!fisicos.has(l.producto_id)) continue
    porProducto.set(l.producto_id, (porProducto.get(l.producto_id) ?? 0) + Number(l.cantidad))
  }

  const verbo = direccion === 'SALIDA' ? 'Venta' : 'Anulación de la venta'
  for (const [producto_id, cantidad] of porProducto) {
    if (!(cantidad > 0)) continue
    await aplicarMovimiento(db, {
      client_id,
      empresa_id:        fac.empresa_id as string,
      fecha:             fac.fecha_emision as string,
      tipo:              direccion,
      producto_id,
      almacen_id:        fac.almacen_id as string,
      cantidad,
      motivo:            `${verbo} — factura ${fac.numero}`,
      origen:            'VENTA',
      referencia_id:     factura_id,
      permitir_negativo: true,
    })
  }
}

/** Traduce los RAISE EXCEPTION de `srv_cxp_*` (mig. 118) a lenguaje humano. */
function traducirErrorCxP(msg: string): string {
  if (msg.includes('CXP_PAGADA')) {
    return 'No se puede anular: ya le pagaste al proveedor de estos servicios. Anula primero el pago en Cuentas por pagar / Tesorería.'
  }
  if (msg.includes('FACTURA_NO_ENCONTRADA')) return 'Factura no encontrada.'
  return msg
}

export async function cambiarEstadoFactura(
  factura_id:   string,
  nuevoEstado:  EstadoFactura,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: factura } = await db
    .from('facturas').select('estado, numero, empresa_id, fecha_emision')
    .eq('factura_id', factura_id)
    .eq('client_id', session.client_id)
    .maybeSingle()
  if (!factura) return { ok: false, error: 'Factura no encontrada.' }
  if (factura.estado === nuevoEstado) return { ok: true }

  // ── Numeración fiscal: se reserva AQUÍ, al emitir, no al crear el borrador ──
  // Así un borrador descartado no deja un salto en la serie. Una que ya tuvo número
  // (se anuló y se resucita) conserva el suyo: el número gastado no se reutiliza.
  let numeroFiscal: string | null = null
  if (nuevoEstado === 'EMITIDA' && esNumeroProvisional(factura.numero as string)) {
    const { data: emp } = await db.from('empresas')
      .select('letra_facturacion').eq('empresa_id', factura.empresa_id as string)
      .eq('client_id', session.client_id).maybeSingle()
    const letra = emp?.letra_facturacion as string | undefined
    if (!letra) return { ok: false, error: 'Asigna una letra de facturación a la empresa antes de emitir.' }

    const anio = new Date(factura.fecha_emision as string).getFullYear()
    try {
      const correlativo = await siguienteCorrelativo(db, session.client_id, factura.empresa_id as string, 'FACTURA', anio)
      numeroFiscal = formatoNumero('FACTURA', letra, anio, correlativo)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  // Bloquear transición EMITIDA → COBRADA: solo se cobra vía registrarPagoDoc
  if (factura.estado === 'EMITIDA' && nuevoEstado === 'COBRADA') {
    return { ok: false, error: 'Usa "Registrar cobro" en lugar de cambiar el estado directamente. Así queda el ingreso en tesorería.' }
  }

  // La CxP al proveedor se revierte ANTES de tocar el estado: si ya se le pagó, la
  // guardia CXP_PAGADA aborta la anulación entera en vez de dejar la factura anulada
  // con la deuda viva (mismo criterio que COMPRA_PAGADA al anular una compra).
  if (nuevoEstado === 'ANULADA') {
    const { error: cxpErr } = await db.rpc('srv_cxp_revertir', {
      p_factura_id: factura_id, p_client_id: session.client_id,
    })
    if (cxpErr) return { ok: false, error: traducirErrorCxP(cxpErr.message) }
  }

  // Rastro mínimo de las dos transiciones que importan (mig. 151): quién y cuándo. Se
  // guarda el EMAIL y no el id de usuario, porque la pregunta «¿quién anuló esto?» suele
  // llegar cuando esa cuenta ya no existe. En una sesión de configuración se anota el
  // correo del equipo, que es exactamente lo que hay que poder distinguir.
  const ahora = new Date().toISOString()
  const quien = session.imp?.admin_email ?? session.email
  const patchRastro =
      nuevoEstado === 'EMITIDA' ? { emitida_por: quien, emitida_at: ahora }
    : nuevoEstado === 'ANULADA' ? { anulada_por: quien, anulada_at: ahora }
    : {}

  // El número y el estado viajan juntos: emitida sin número no puede existir.
  const patchEstado = { estado: nuevoEstado, updated_at: ahora, ...patchRastro }
  let { error } = await db.from('facturas')
    .update(numeroFiscal ? { ...patchEstado, numero: numeroFiscal } : patchEstado)
    .eq('factura_id', factura_id)
    .eq('client_id', session.client_id)

  // `siguienteCorrelativo` es read-modify-write no atómica: dos emisiones a la vez
  // pueden pedir el mismo número y el índice único para a la segunda. Se reintenta una
  // sola vez con el siguiente libre, que es lo que antes hacía la creación en bucle.
  if (error && numeroFiscal && error.message.includes('duplicate key')) {
    const anio = new Date(factura.fecha_emision as string).getFullYear()
    const { data: emp } = await db.from('empresas')
      .select('letra_facturacion').eq('empresa_id', factura.empresa_id as string)
      .eq('client_id', session.client_id).maybeSingle()
    const correlativo = await siguienteCorrelativo(db, session.client_id, factura.empresa_id as string, 'FACTURA', anio)
    numeroFiscal = formatoNumero('FACTURA', emp!.letra_facturacion as string, anio, correlativo)
    ;({ error } = await db.from('facturas')
      .update({ ...patchEstado, numero: numeroFiscal })
      .eq('factura_id', factura_id)
      .eq('client_id', session.client_id))
  }
  if (error) return { ok: false, error: error.message }

  // Emitir engendra la CxP a los proveedores de los servicios vendidos. Es idempotente,
  // así que el vaivén emitir → anular → emitir no duplica la deuda.
  if (nuevoEstado === 'EMITIDA') {
    await db.rpc('srv_cxp_generar', { p_factura_id: factura_id, p_client_id: session.client_id })
    revalidatePath('/portal/gastos')
    revalidatePath('/portal/cxp')
  }
  if (nuevoEstado === 'ANULADA') {
    revalidatePath('/portal/gastos')
    revalidatePath('/portal/cxp')
  }

  // Existencias (mig. 150). Va DESPUÉS del cambio de estado y sin abortarlo si falla:
  // el documento fiscal ya está emitido —con su número gastado— y no puede quedar en
  // el aire porque un almacén no cuadre. Si algo sale mal, el movimiento se corrige a
  // mano en Inventario, que es reversible; deshacer una emisión, no.
  if (nuevoEstado === 'EMITIDA' || nuevoEstado === 'ANULADA') {
    try {
      await moverStockFactura(db, session.client_id, factura_id,
        nuevoEstado === 'EMITIDA' ? 'SALIDA' : 'ENTRADA')
      revalidatePath('/portal/inventario')
      revalidatePath('/portal/productos')
    } catch { /* el estado manda; el movimiento se reintenta corrigiendo en Inventario */ }
  }

  // Anular es deshacer: si la factura salió de la facturación del período, sus
  // suscripciones tienen el próximo cobro ya avanzado. Sin retroceder, ese período
  // quedaría cobrado en los papeles y sin factura, imposible de regenerar.
  // Resucitar una anulada (ANULADA → BORRADOR/EMITIDA) rehace el avance, para que el
  // ir y venir no deje la fecha corrida un período.
  if (nuevoEstado === 'ANULADA' || factura.estado === 'ANULADA') {
    await moverCobroSuscripciones(db, session.client_id, factura_id, nuevoEstado === 'ANULADA' ? restarPeriodo : sumarPeriodo)
    revalidatePath('/portal/suscripciones')
  }

  revalidatePath('/portal/ventas')
  revalidatePath(`/portal/ventas/facturas/${factura_id}`)
  revalidarFinanzas()
  return { ok: true }
}

/** Mueve `fecha_proximo_cobro` de las suscripciones facturadas por `factura_id`. */
async function moverCobroSuscripciones(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, client_id: string, factura_id: string,
  mover: (fecha: string, per: PeriodicidadSub) => string,
): Promise<void> {
  const { data: lineas } = await db.from('documento_lineas')
    .select('suscripcion_id')
    .eq('documento_tipo', 'FACTURA').eq('documento_id', factura_id)
    .not('suscripcion_id', 'is', null)
  const ids = [...new Set(((lineas ?? []) as { suscripcion_id: string }[]).map(l => l.suscripcion_id))]
  if (!ids.length) return

  const { data: subs } = await db.from('suscripciones')
    .select('suscripcion_id, fecha_proximo_cobro, periodicidad')
    .eq('client_id', client_id).in('suscripcion_id', ids)

  for (const s of (subs ?? []) as { suscripcion_id: string; fecha_proximo_cobro: string; periodicidad: PeriodicidadSub }[]) {
    await db.from('suscripciones').update({
      fecha_proximo_cobro: mover(s.fecha_proximo_cobro, s.periodicidad),
      updated_at:          new Date().toISOString(),
    }).eq('suscripcion_id', s.suscripcion_id).eq('client_id', client_id)
  }
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

  // La factura nace BORRADOR y sin número fiscal: lo recibirá al emitirse.
  const factura_id = generarIdDocumento('FAC')
  const numero     = numeroProvisional(factura_id)

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineasOferta = linRes.data as any[]
    // La foto del coste se REFRESCA aquí: la factura es el hecho contable, y una oferta
    // de enero convertida en julio no debe traerse el coste de enero. Si el catálogo ya
    // no tiene coste en esa moneda, se conserva el de la oferta antes que perderlo.
    const costos = await fotoDeCostes(db, session.client_id, oferta.moneda as string,
      lineasOferta.map(l => ({ producto_id: l.producto_id })) as LineaInput[])

    await db.from('documento_lineas').insert(
      lineasOferta.map(l => ({
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
        costo_unitario:    (l.producto_id ? costos.get(l.producto_id) : null) ?? l.costo_unitario ?? null,
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

  const nueva_id = generarIdDocumento('OFE')
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

  const hoy = new Date().toISOString().substring(0, 10)

  // La copia nace BORRADOR y sin número fiscal: duplicar para probar ya no gasta serie.
  const nueva_id = generarIdDocumento('FAC')
  const numero   = numeroProvisional(nueva_id)

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
    // La intención de descontar stock SÍ se copia (es parte del documento), pero no
    // mueve nada: la copia nace BORRADOR y el stock se mueve al emitir.
    descuenta_stock:  factura.descuenta_stock ?? false,
    almacen_id:       factura.almacen_id ?? null,
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
        // La foto del coste SE COPIA. Sin ella la factura duplicada sale con margen 0
        // en Reportes, y duplicar es justo el camino del cliente recurrente: el
        // margen que más se repite era el que más se falseaba.
        // Lo que NO se copia es `suscripcion_id`: es el rastro de idempotencia de la
        // facturación del período, y un segundo rastro dejaría el mes cobrado dos veces.
        costo_unitario:    l.costo_unitario ?? null,
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
  // Configurador (modo configuración): puede FORZAR el borrado de cualquier oferta,
  // aunque no esté en un estado eliminable o tenga factura asociada. Vía de limpieza
  // de datos de prueba; el usuario normal mantiene las reglas de siempre.
  const config = !!session.imp

  const db = createAdminClient()
  const { data: docs } = await db.from('ofertas')
    .select('oferta_id, numero, estado, factura_id')
    .eq('client_id', session.client_id).in('oferta_id', ids)

  const res = loteVacio()
  const borrables: string[] = []
  for (const d of (docs ?? []) as { oferta_id: string; numero: string; estado: EstadoOferta; factura_id: string | null }[]) {
    if (!config && d.factura_id) { res.omitidas.push({ numero: d.numero, motivo: 'tiene factura asociada' }); continue }
    if (!config && !OFERTA_ELIMINABLE.includes(d.estado)) {
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
  // Configurador (modo configuración, `session.imp`): puede FORZAR el borrado de
  // cualquier factura, no solo BORRADOR. Es la vía para limpiar datos de prueba de
  // un cliente. Un usuario normal sigue con la regla de siempre (solo BORRADOR).
  const config = !!session.imp

  const db = createAdminClient()
  const { data: docs } = await db.from('facturas')
    .select('factura_id, numero, estado')
    .eq('client_id', session.client_id).in('factura_id', ids)

  const res = loteVacio()
  const borrables: string[] = []
  for (const d of (docs ?? []) as { factura_id: string; numero: string; estado: EstadoFactura }[]) {
    if (!config && !FACTURA_ELIMINABLE.includes(d.estado)) {
      res.omitidas.push({ numero: d.numero, motivo: `no se elimina en estado ${ESTADO_FACTURA_LABEL[d.estado]} (anúlala)` }); continue
    }
    borrables.push(d.factura_id)
  }
  if (borrables.length) {
    // Una factura BORRADOR puede venir de una oferta aprobada: soltar el enlace
    // para no dejar la oferta apuntando a una factura inexistente.
    await db.from('ofertas').update({ factura_id: null })
      .eq('client_id', session.client_id).in('factura_id', borrables)

    // Y puede venir de la facturación del período. Borrarla se lleva por delante el
    // rastro `suscripcion_id` de sus líneas, que es LA defensa contra facturar dos
    // veces; si además dejáramos el `fecha_proximo_cobro` avanzado, ese período
    // quedaría cobrado en los papeles, sin factura y sin forma de regenerarlo. Se
    // retrocede ANTES de borrar las líneas, que es de donde se leen.
    for (const factura_id of borrables) {
      await moverCobroSuscripciones(db, session.client_id, factura_id, restarPeriodo)
    }

    // Configurador forzando el borrado de facturas no-BORRADOR: llevarse también sus
    // cobros/pagos de Tesorería, si no quedarían movimientos huérfanos apuntando a
    // una factura inexistente (y descuadrando saldos y reportes).
    if (config) {
      // Y la CxP a los proveedores de servicios que engendró al emitirse (mig. 118):
      // sin este reverso, el gasto «Servicios de terceros» sobrevive apuntando a una
      // factura que ya no existe. Sus pagos se borran ANTES de llamar a la RPC porque
      // `srv_cxp_revertir` aborta con CXP_PAGADA si el proveedor ya está pagado — la
      // guardia es correcta para el dueño, pero en modo limpieza estamos justamente
      // borrando el pago también.
      const { data: cxps } = await db.from('gastos_cobros')
        .select('registro_id')
        .eq('client_id', session.client_id)
        .eq('origen_tipo', 'FACTURA')
        .in('origen_id', borrables)
      const cxpIds = ((cxps ?? []) as { registro_id: string }[]).map(g => g.registro_id)
      if (cxpIds.length) {
        await db.from('movimientos_tesoreria').delete()
          .eq('client_id', session.client_id).in('referencia_id', cxpIds)
      }
      for (const factura_id of borrables) {
        await db.rpc('srv_cxp_revertir', { p_factura_id: factura_id, p_client_id: session.client_id })
        // Y las existencias que sacó al emitirse (mig. 150): devolverlas ANTES de borrar
        // las líneas, que es de donde se leen las cantidades. Sin esto el stock se queda
        // corto por una venta que ya no existe en ningún sitio.
        try { await moverStockFactura(db, session.client_id, factura_id, 'ENTRADA') } catch { /* limpieza: no aborta el lote */ }
      }
      await db.from('movimientos_tesoreria').delete()
        .eq('client_id', session.client_id)
        .in('origen', ['COBRO', 'PAGO'])
        .in('referencia_id', borrables)
    }

    await db.from('documento_lineas').delete().eq('documento_tipo', 'FACTURA').in('documento_id', borrables)
    await db.from('documento_ajustes').delete().eq('documento_tipo', 'FACTURA').in('documento_id', borrables)
    const { error } = await db.from('facturas').delete()
      .eq('client_id', session.client_id).in('factura_id', borrables)
    if (error) res.errores.push({ numero: '—', error: error.message })
    else res.hechas = borrables.length
  }
  revalidatePath('/portal/ventas')
  revalidatePath('/portal/suscripciones')
  revalidarFinanzas()
  return res
}
