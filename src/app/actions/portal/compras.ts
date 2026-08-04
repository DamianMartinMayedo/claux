'use server'

import { revalidatePath }    from 'next/cache'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { traducirErrorInventario } from './_inventario-helpers'
import { monedaValida, mapaTasas } from '@/lib/tasas'
import { parseNumeroEs }     from '@/lib/numeros'
import { limiteDelFiltro, rangoUltimosMeses, type FiltroListado } from '@/lib/listados'
import { minimoAplicable } from '@/lib/inventario/stock'
// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: con `toISOString()` a partir de
// las 20:00 la fecha ya es la de mañana, así que un documento registrado de noche el último
// día del mes caía en el mes siguiente. Una sola fuente: `lib/fecha-tz.ts`.
import { hoyEnTz } from '@/lib/fecha-tz'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type EstadoCompra = 'BORRADOR' | 'CONFIRMADA' | 'ANULADA'

export interface Compra {
  compra_id:    string
  numero:       string
  client_id:    string
  empresa_id:   string
  proveedor_id: string | null
  almacen_id:   string
  fecha:        string
  moneda:       string
  estado:       EstadoCompra
  total:        number
  notas:        string | null
  gasto_id:     string | null
  created_at:   string
  updated_at:   string
}

export interface CompraLinea {
  linea_id:       number
  compra_id:      string
  orden:          number
  producto_id:    string | null
  descripcion:    string
  cantidad:       number
  costo_unitario: number
  total:          number
}

export interface ProductoCompra {
  producto_id: string
  codigo:      string
  nombre:      string
  unidad:      string
  costos:      Record<string, number>
}

/** Datos de formulario compartidos por el listado y el detalle (sin el listado). */
export interface FormCompra {
  proveedores:     { tercero_id: string; nombre: string; empresa_id: string; moneda_defecto: string | null }[]
  almacenes:       { almacen_id: string; nombre: string; empresa_id: string }[]
  productos:       ProductoCompra[]
  monedas:         string[]
  /**
   * `"ORIGEN__DESTINO"` → factor, para el atajo al cambiar de moneda (mismo mapa que
   * Citas y el alta de suscripciones). Cambiar de moneda NO puede arrastrar el importe
   * —10.000 CUP no son 10.000 USD—, así que se vacía y la tasa se OFRECE.
   */
  tasas:           Record<string, number>
  empresa_nombres: Record<string, string>
  proveedor_nombres: Record<string, string>
  almacen_nombres: Record<string, string>
}

export interface ComprasPageData extends FormCompra {
  compras:         Compra[]
  /** Rango realmente aplicado por el servidor, para que la píldora activa no mienta. */
  rango:           { desde: string; hasta: string }
  /** Se tocó el techo de filas: hay más de las que se enseñan. */
  hay_mas:         boolean
  /** Cuántas compras hay DE VERDAD en el rango (sin techo). */
  total:           number
  limite:          number
}

export interface CompraDetalleData {
  compra:        Compra
  lineas:        CompraLinea[]
  proveedor:     { tercero_id: string; nombre: string } | null
  almacen:       { almacen_id: string; nombre: string } | null
  empresa_nombre: string
  // datos para edición de borrador
  proveedores:   ComprasPageData['proveedores']
  almacenes:     ComprasPageData['almacenes']
  productos:     ProductoCompra[]
  monedas:       string[]
  tasas:         Record<string, number>
  // pago vinculado (si está confirmada)
  pagado:        number
  saldo:         number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generarCompraId(): string {
  return `CMP-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
function hoy(): string {
  return hoyEnTz()
}
// Redondeo a 2 decimales evitando drift de coma flotante en importes.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Reserva el siguiente correlativo de compra para (empresa, año) → COM-AAAA-####
async function siguienteNumeroCompra(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, client_id: string, empresa_id: string, anio: number,
): Promise<string> {
  const { data: existente } = await db.from('consecutivos_compra')
    .select('ultimo_numero')
    .eq('client_id', client_id).eq('empresa_id', empresa_id).eq('anio', anio)
    .maybeSingle()
  const nuevo = (existente?.ultimo_numero ?? 0) + 1
  const { error } = await db.from('consecutivos_compra').upsert({
    client_id, empresa_id, anio, ultimo_numero: nuevo, updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id,empresa_id,anio' })
  if (error) throw new Error(`No se pudo reservar consecutivo de compra: ${error.message}`)
  return `COM-${anio}-${String(nuevo).padStart(4, '0')}`
}

interface LineaInput {
  producto_id:    string | null
  descripcion:    string
  cantidad:       number
  costo_unitario: number
}

function parseLineas(raw: FormDataEntryValue | null): LineaInput[] {
  if (!raw || typeof raw !== 'string') return []
  try {
    const arr = JSON.parse(raw) as LineaInput[]
    return arr
      .map(l => ({
        producto_id:    l.producto_id || null,
        descripcion:    (l.descripcion ?? '').trim(),
        // parseNumeroEs y no Number(): las líneas llegan como JSON del formulario y
        // el candado real está aquí, no en el input (lib/numeros.ts).
        cantidad:       parseNumeroEs(l.cantidad),
        costo_unitario: parseNumeroEs(l.costo_unitario),
      }))
      .filter(l => l.descripcion && l.cantidad > 0)
  } catch { return [] }
}

// ── Obtener listado + datos de formulario ──────────────────────────────────────

export async function obtenerCompras(filtro?: FiltroListado): Promise<ComprasPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  // Traía TODAS las compras sin rango ni techo: en un negocio con años de historia
  // eso son miles de filas por 3G. Mismo contrato que los listados de Contabilidad.
  const porDefecto = rangoUltimosMeses(3)
  const desde  = filtro?.desde ?? porDefecto.desde
  const hasta  = filtro?.hasta ?? porDefecto.hasta
  const limite = limiteDelFiltro(filtro)

  // `count: 'exact'`: el aviso del techo tiene que decir CUÁNTAS faltan, no solo que
  // faltan. Sin el total, «acota el rango» era el único consejo posible.
  let compQuery = db.from('compras').select('*', { count: 'exact' })
    .eq('client_id', session.client_id)
    .in('empresa_id', idsFiltro)
  if (desde) compQuery = compQuery.gte('fecha', desde)
  if (hasta) compQuery = compQuery.lte('fecha', hasta)
  // El filtro de la barra, cuando la vista lo ESCALA porque el listado está recortado.
  if (filtro?.estado) compQuery = compQuery.eq('estado', filtro.estado)
  compQuery = compQuery
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limite)

  const [compRes, form] = await Promise.all([
    compQuery,
    cargarFormCompra(db, session.client_id, idsFiltro, empresas),
  ])

  const compras = (compRes.data ?? []) as Compra[]
  return {
    compras,
    rango: { desde, hasta },
    hay_mas: compras.length >= limite,
    total:   compRes.count ?? compras.length,
    limite,
    ...form,
  }
}

export interface FaltaReposicion {
  producto_id: string
  nombre:      string
  unidad:      string
  /** Lo que falta para llegar al mínimo de ESE almacén. */
  falta:       number
  actual:      number
  minimo:      number
  proveedor_id: string | null
  /** Nombre del proveedor, o «Sin proveedor». */
  proveedor:   string
  costo:       number | null
  moneda:      string
}

export interface PreviewReposicion {
  /** Todos los almacenes activos con cuántas referencias les faltan: se ELIGE dónde. */
  almacenes:  { almacen_id: string; nombre: string; faltan: number }[]
  almacen_id: string
  faltas:     FaltaReposicion[]
}

/**
 * Qué falta y a quién se le compra, ANTES de crear nada.
 *
 * Existe porque la primera versión creaba borradores a ciegas sobre «el primer almacén
 * activo» —con seis almacenes, una lotería— y se comía en silencio los productos sin
 * proveedor. Ahora el dueño ve el almacén, la lista y a quién va cada línea, y decide.
 *
 * **Sin `almacen_id` NO se adivina uno**: se devuelve la lista con cuántas referencias
 * le faltan a cada uno y ya elige. Elegir «el que más falta» parecía listo y era lo
 * contrario: el almacén con más faltantes es el que está VACÍO (una consignación sin
 * usar, donde falta absolutamente todo), o sea que la pantalla se abría proponiendo
 * comprar el catálogo entero para un almacén que no se usa.
 */
export async function previsualizarReposicion(almacen_id?: string): Promise<PreviewReposicion> {
  const session = await getPortalSession()
  if (!session) return { almacenes: [], almacen_id: '', faltas: [] }

  const db = createAdminClient()
  const { productos, almacenes, cantidadDe, minAlm, nombreProv, monedaProv, monedaBase } =
    await datosReposicion(db, session.client_id)

  const faltanPorAlmacen = almacenes.map(a => ({
    almacen_id: a.almacen_id,
    nombre:     a.nombre,
    faltan:     faltaEn(productos, a.almacen_id, cantidadDe, minAlm).length,
  }))
  const destino = almacen_id ?? ''

  const faltas: FaltaReposicion[] = faltaEn(productos, destino, cantidadDe, minAlm).map(f => {
    const moneda = (f.p.proveedor_id ? monedaProv.get(f.p.proveedor_id) : null) || monedaBase
    return {
      producto_id: f.p.producto_id,
      nombre:      f.p.nombre,
      unidad:      f.p.unidad ?? '',
      falta:       f.falta,
      actual:      f.actual,
      minimo:      f.minimo,
      proveedor_id: f.p.proveedor_id,
      proveedor:   f.p.proveedor_id ? (nombreProv.get(f.p.proveedor_id) ?? f.p.proveedor_id) : 'Sin proveedor',
      costo:       f.p.costos?.[moneda] ?? null,
      moneda,
    }
  })

  return { almacenes: faltanPorAlmacen, almacen_id: destino, faltas }
}

/**
 * Crea BORRADORES de compra con lo elegido, **uno por proveedor**.
 *
 * Es la última pieza de la cadena: el mínimo por almacén detecta la falta (Fase 2),
 * «Revisar» y la cobertura la ordenan por urgencia (Fases 3 y 7) y esto la convierte
 * en la compra que hay que hacer.
 *
 * Lo que NO tiene proveedor va a **un borrador sin proveedor**, no a la basura: en un
 * catálogo real casi ningún producto lo tiene puesto, y saltárselos dejaba la función
 * sin hacer nada. El dueño le pone el proveedor a esa compra y ya.
 *
 * NADA se confirma: se dejan en borrador para que ajuste cantidades y costes y
 * confirme él. La cantidad sugerida es la que falta para llegar al mínimo.
 */
export async function crearComprasDeReposicion(
  almacen_id: string,
  producto_ids: string[],
): Promise<{ ok: boolean; error?: string; creadas?: number; compra_id?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!almacen_id) return { ok: false, error: 'Elige el almacén que hay que reponer.' }
  if (!producto_ids?.length) return { ok: false, error: 'No has marcado ningún producto.' }

  const db = createAdminClient()
  const { productos, almacenes, cantidadDe, minAlm, monedaProv, monedaBase } =
    await datosReposicion(db, session.client_id)

  const destino = almacenes.find(a => a.almacen_id === almacen_id)
  if (!destino) return { ok: false, error: 'Ese almacén no existe o está archivado.' }

  const marcados = new Set(producto_ids)
  const faltantes = faltaEn(productos, almacen_id, cantidadDe, minAlm)
    .filter(f => marcados.has(f.p.producto_id))
  if (faltantes.length === 0) {
    return { ok: false, error: `Ya no falta nada de lo que marcaste en ${destino.nombre}.` }
  }

  // Un borrador por proveedor; los sin proveedor, todos juntos en uno.
  const SIN = '__sin_proveedor__'
  const porProveedor = new Map<string, typeof faltantes>()
  for (const f of faltantes) {
    const clave = f.p.proveedor_id ?? SIN
    const arr = porProveedor.get(clave) ?? []
    arr.push(f)
    porProveedor.set(clave, arr)
  }

  const anio = new Date().getFullYear()
  let creadas = 0
  let ultima  = ''
  for (const [clave, lineas] of porProveedor) {
    const proveedor_id = clave === SIN ? null : clave
    const moneda = (proveedor_id ? monedaProv.get(proveedor_id) : null) || monedaBase
    if (!await monedaValida(db, session.client_id, moneda)) continue

    const compra_id = generarCompraId()
    let numero: string
    try {
      numero = await siguienteNumeroCompra(db, session.client_id, destino.empresa_id, anio)
    } catch { continue }

    const filas = lineas.map((l, i) => {
      const costo = l.p.costos?.[moneda] ?? 0
      return {
        compra_id, client_id: session.client_id, orden: i,
        producto_id: l.p.producto_id,
        descripcion: l.p.nombre,
        cantidad: l.falta,
        costo_unitario: costo,
        total: round2(l.falta * costo),
      }
    })
    const total = round2(filas.reduce((s, f) => s + f.total, 0))

    const { error: eC } = await db.from('compras').insert({
      compra_id, numero, client_id: session.client_id,
      empresa_id: destino.empresa_id, almacen_id: destino.almacen_id,
      proveedor_id, fecha: hoy(), moneda, estado: 'BORRADOR', total,
      notas: `Reposición sugerida para ${destino.nombre}. Revisa cantidades y costes antes de confirmar.`,
      updated_at: new Date().toISOString(),
    })
    if (eC) continue
    if (filas.length) await db.from('compra_lineas').insert(filas)
    creadas++
    ultima = compra_id
  }

  if (creadas === 0) return { ok: false, error: 'No se pudo crear ningún borrador.' }

  revalidatePath('/portal/compras')
  return { ok: true, creadas, compra_id: creadas === 1 ? ultima : undefined }
}

// ── Reposición: los datos y el cálculo, una sola vez ───────────────────────────
// Internas y NO exportadas: en un fichero 'use server' cada exportación es un endpoint
// HTTP, así que una función que recibiera `client_id` por parámetro sería una puerta
// abierta al tenant ajeno. La previsualización y la creación comparten esto para no
// poder calcular «lo que falta» de dos maneras distintas.

type PrdRepo = {
  producto_id: string; nombre: string; unidad: string; stock_minimo: number
  costos: Record<string, number> | null; proveedor_id: string | null
}

async function datosReposicion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, client_id: string,
) {
  const [{ data: prods }, { data: stock }, { data: cfg }, { data: alms }, { data: provs }, { data: mons }] =
    await Promise.all([
      db.from('products').select('producto_id, nombre, unidad, stock_minimo, costos, proveedor_id')
        .eq('client_id', client_id).eq('estado', 'ACTIVO').eq('tipo', 'PRODUCTO').order('nombre'),
      db.from('stock_almacenes').select('producto_id, almacen_id, cantidad').eq('client_id', client_id),
      db.from('producto_almacen_config').select('producto_id, almacen_id, stock_minimo')
        .eq('client_id', client_id).not('stock_minimo', 'is', null),
      // `activo`, no `estado`: los almacenes archivan con el convenio contrario al de
      // products, y pedir la columna que no existe rompe la consulta ENTERA.
      db.from('almacenes').select('almacen_id, nombre, empresa_id')
        .eq('client_id', client_id).eq('activo', true).order('nombre'),
      db.from('third_parties').select('tercero_id, nombre, moneda_defecto')
        .eq('client_id', client_id).in('tipo', ['PROVEEDOR', 'AMBOS']),
      db.from('monedas').select('codigo').eq('client_id', client_id).eq('activa', true).order('codigo'),
    ])

  type Prov = { tercero_id: string; nombre: string; moneda_defecto: string | null }
  return {
    productos: (prods ?? []) as PrdRepo[],
    almacenes: (alms ?? []) as { almacen_id: string; nombre: string; empresa_id: string }[],
    cantidadDe: new Map(((stock ?? []) as { producto_id: string; almacen_id: string; cantidad: number }[])
      .map(s => [`${s.producto_id}@${s.almacen_id}`, Number(s.cantidad)])),
    minAlm: new Map(((cfg ?? []) as { producto_id: string; almacen_id: string; stock_minimo: number }[])
      .map(c => [`${c.producto_id}@${c.almacen_id}`, Number(c.stock_minimo)])),
    nombreProv: new Map(((provs ?? []) as Prov[]).map(p => [p.tercero_id, p.nombre])),
    monedaProv: new Map(((provs ?? []) as Prov[]).map(p => [p.tercero_id, p.moneda_defecto])),
    // La moneda del cliente, no un 'USD' inventado: una moneda que no tiene no cotiza
    // y rompe el proceso al validarla.
    monedaBase: ((mons ?? [])[0]?.codigo as string) ?? 'USD',
  }
}

/** Lo que falta en UN almacén para llegar a su mínimo (el global si no tiene propio). */
function faltaEn(
  productos: PrdRepo[], almacen_id: string,
  cantidadDe: Map<string, number>, minAlm: Map<string, number>,
): { p: PrdRepo; falta: number; actual: number; minimo: number }[] {
  if (!almacen_id) return []
  const out: { p: PrdRepo; falta: number; actual: number; minimo: number }[] = []
  for (const p of productos) {
    const clave  = `${p.producto_id}@${almacen_id}`
    const actual = cantidadDe.get(clave) ?? 0
    const minimo = minimoAplicable(minAlm.get(clave), p.stock_minimo)
    if (minimo <= 0) continue
    if (actual > minimo) continue
    const falta = round2(minimo - actual)
    if (falta <= 0) continue
    out.push({ p, falta, actual, minimo })
  }
  return out
}

/**
 * Duplica una compra como BORRADOR nuevo: mismas líneas, hoy, sin número ni gasto.
 *
 * Comprar al mismo proveedor lo mismo de siempre es la operación repetida del
 * módulo, y hasta ahora había que teclearla entera cada mes. No se copia el estado
 * ni el gasto —eso lo genera confirmar—, y el coste se toma de la compra original
 * (que es lo que se va a ajustar), no del catálogo.
 */
export async function duplicarCompra(
  compra_id: string,
): Promise<{ ok: boolean; error?: string; compra_id?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: orig } = await db.from('compras').select('*')
    .eq('compra_id', compra_id).eq('client_id', session.client_id).maybeSingle()
  if (!orig) return { ok: false, error: 'Compra no encontrada.' }

  const { data: lineas } = await db.from('compra_lineas').select('*')
    .eq('compra_id', compra_id).eq('client_id', session.client_id).order('orden')

  const nuevo = generarCompraId()
  const hoy   = hoyEnTz()

  // `compras.numero` es NOT NULL desde la mig. 036 y el borrador ya nace numerado:
  // se pide el siguiente del consecutivo, igual que al crear a mano. Copiar el número
  // del original rompería el índice único (client_id, numero).
  let numero: string
  try {
    numero = await siguienteNumeroCompra(db, session.client_id, orig.empresa_id as string, new Date(hoy).getFullYear())
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de numeración.' }
  }

  const { error: eC } = await db.from('compras').insert({
    compra_id:    nuevo,
    numero,
    client_id:    session.client_id,
    empresa_id:   orig.empresa_id,
    almacen_id:   orig.almacen_id,
    proveedor_id: orig.proveedor_id,
    moneda:       orig.moneda,
    fecha:        hoy,
    estado:       'BORRADOR',
    total:        orig.total,
    notas:        orig.notas,
    updated_at:   new Date().toISOString(),
  })
  if (eC) return { ok: false, error: eC.message }

  const filas = ((lineas ?? []) as Record<string, unknown>[]).map((l, i) => ({
    // OJO: no se arrastra `linea_id` (identity): dejar que la BD lo genere.
    compra_id:      nuevo,
    client_id:      session.client_id,
    orden:          (l.orden as number) ?? i,
    producto_id:    l.producto_id as string | null,
    descripcion:    l.descripcion as string,
    cantidad:       l.cantidad as number,
    costo_unitario: l.costo_unitario as number,
    total:          l.total as number,
  }))
  if (filas.length) {
    const { error: eL } = await db.from('compra_lineas').insert(filas)
    if (eL) return { ok: false, error: eL.message }
  }

  revalidatePath('/portal/compras')
  return { ok: true, compra_id: nuevo }
}

// Datos de formulario compartidos por el listado y el detalle (evita refetch de
// la lista completa en el detalle): proveedores, almacenes, productos
// seleccionables y monedas, con sus mapas de nombres.
async function cargarFormCompra(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, client_id: string, idsFiltro: string[],
  empresas: { empresa_id: string; nombre: string }[],
): Promise<FormCompra> {
  const [provRes, almRes, prodRes, monRes] = await Promise.all([
    db.from('third_parties')
      .select('tercero_id, nombre, empresa_id, moneda_defecto')
      .eq('client_id', client_id).in('empresa_id', idsFiltro)
      .in('tipo', ['PROVEEDOR', 'AMBOS']).eq('activo', true).order('nombre'),
    db.from('almacenes')
      .select('almacen_id, nombre, empresa_id')
      .eq('client_id', client_id).in('empresa_id', idsFiltro).eq('activo', true).order('nombre'),
    db.from('products')
      .select('producto_id, codigo, nombre, unidad, costos')
      .eq('client_id', client_id).eq('estado', 'ACTIVO').eq('tipo', 'PRODUCTO').order('nombre'),
    db.from('monedas')
      .select('codigo').eq('client_id', client_id).eq('activa', true).order('codigo'),
  ])

  const proveedores = (provRes.data ?? []) as ComprasPageData['proveedores']
  const almacenes   = (almRes.data  ?? []) as ComprasPageData['almacenes']
  const productos   = ((prodRes.data ?? []) as Record<string, unknown>[]).map(p => ({
    producto_id: p.producto_id as string,
    codigo:      p.codigo as string,
    nombre:      p.nombre as string,
    unidad:      p.unidad as string,
    costos:      (typeof p.costos === 'object' && p.costos !== null) ? p.costos as Record<string, number> : {},
  }))
  const monedas = (monRes.data ?? []).map((m: { codigo: string }) => m.codigo)

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre
  const proveedor_nombres: Record<string, string> = {}
  for (const p of proveedores) proveedor_nombres[p.tercero_id] = p.nombre
  const almacen_nombres: Record<string, string> = {}
  for (const a of almacenes) almacen_nombres[a.almacen_id] = a.nombre

  const monedasFinal = monedas.length ? monedas : ['USD']
  return {
    proveedores, almacenes, productos,
    monedas: monedasFinal,
    tasas: await mapaTasas(db, client_id, monedasFinal),
    empresa_nombres, proveedor_nombres, almacen_nombres,
  }
}

// ── Detalle ─────────────────────────────────────────────────────────────────────

export async function obtenerCompraDetalle(compra_id: string): Promise<CompraDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [compraRes, lineasRes, form] = await Promise.all([
    db.from('compras').select('*')
      .eq('compra_id', compra_id).eq('client_id', session.client_id).maybeSingle(),
    db.from('compra_lineas').select('*')
      .eq('compra_id', compra_id).eq('client_id', session.client_id).order('orden'),
    cargarFormCompra(db, session.client_id, idsFiltro, empresas),
  ])

  const compra = compraRes.data as Compra | null
  if (!compra) return null

  const lineas = ((lineasRes.data ?? []) as Record<string, unknown>[]).map(l => ({
    linea_id:       Number(l.linea_id),
    compra_id:      l.compra_id as string,
    orden:          Number(l.orden),
    producto_id:    (l.producto_id as string) ?? null,
    descripcion:    l.descripcion as string,
    cantidad:       Number(l.cantidad),
    costo_unitario: Number(l.costo_unitario),
    total:          Number(l.total),
  })) as CompraLinea[]

  // Pago vinculado (si confirmada y con gasto)
  let pagado = 0
  if (compra.gasto_id) {
    const { data: liqs } = await db.from('movimientos_tesoreria')
      .select('monto').eq('client_id', session.client_id)
      .eq('referencia_id', compra.gasto_id).eq('origen', 'PAGO')
    pagado = (liqs ?? []).reduce((s: number, m: { monto: number }) => s + Number(m.monto), 0)
  }

  return {
    compra,
    lineas,
    proveedor:      compra.proveedor_id ? { tercero_id: compra.proveedor_id, nombre: form.proveedor_nombres[compra.proveedor_id] ?? compra.proveedor_id } : null,
    almacen:        { almacen_id: compra.almacen_id, nombre: form.almacen_nombres[compra.almacen_id] ?? compra.almacen_id },
    empresa_nombre: form.empresa_nombres[compra.empresa_id] ?? compra.empresa_id,
    proveedores:    form.proveedores,
    almacenes:      form.almacenes,
    productos:      form.productos,
    monedas:        form.monedas,
    tasas:          form.tasas,
    pagado,
    saldo:          Math.max(0, Number(compra.total) - pagado),
  }
}

// ── Guardar borrador (crear / editar) ───────────────────────────────────────────

export async function guardarCompra(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; compra_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const compra_id_form = ((formData.get('compra_id')   as string) ?? '').trim()
  const almacen_id     = ((formData.get('almacen_id')  as string) ?? '').trim()
  const proveedor_id   = ((formData.get('proveedor_id') as string) ?? '').trim() || null
  const moneda         = ((formData.get('moneda')      as string) ?? '').trim()
  const fecha          = ((formData.get('fecha')       as string) ?? '').trim() || hoy()
  const notas          = ((formData.get('notas')       as string) ?? '').trim() || null
  const lineas         = parseLineas(formData.get('lineas'))

  if (!almacen_id) return { ok: false, error: 'Selecciona el almacén de entrada.' }
  if (!moneda)     return { ok: false, error: 'Selecciona la moneda.' }
  if (lineas.length === 0) return { ok: false, error: 'Añade al menos una línea con cantidad.' }

  // El almacén determina la empresa
  const { data: alm } = await db.from('almacenes')
    .select('empresa_id').eq('almacen_id', almacen_id).eq('client_id', session.client_id).single()
  if (!alm) return { ok: false, error: 'Almacén no válido.' }
  const empresa_id = alm.empresa_id as string

  const total = round2(lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0))

  // ── Editar (solo BORRADOR) ──
  if (compra_id_form) {
    const { data: existente } = await db.from('compras')
      .select('estado, empresa_id, numero, moneda').eq('compra_id', compra_id_form).eq('client_id', session.client_id).single()
    if (!existente)                      return { ok: false, error: 'Compra no encontrada.' }
    if (existente.estado !== 'BORRADOR') return { ok: false, error: 'Solo se pueden editar compras en borrador.' }
    // Solo si cambia la moneda: una heredada que se desactivó no debe bloquear la edición.
    if (moneda !== existente.moneda && !await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
    }

    // #7: si cambia la empresa (por cambio de almacén), re-numerar para que el
    // correlativo COM-AAAA-#### siga siendo coherente por empresa.
    let numero = existente.numero as string
    if (empresa_id !== existente.empresa_id) {
      try {
        numero = await siguienteNumeroCompra(db, session.client_id, empresa_id, new Date(fecha).getFullYear())
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Error de numeración.' }
      }
    }

    const { error: upErr } = await db.from('compras').update({
      almacen_id, proveedor_id, moneda, fecha, notas, total, empresa_id, numero,
      updated_at: new Date().toISOString(),
    }).eq('compra_id', compra_id_form).eq('client_id', session.client_id)
    if (upErr) return { ok: false, error: upErr.message }

    await db.from('compra_lineas').delete().eq('compra_id', compra_id_form).eq('client_id', session.client_id)
    const { error: linErr } = await db.from('compra_lineas').insert(
      lineas.map((l, i) => ({
        compra_id: compra_id_form, client_id: session.client_id, orden: i,
        producto_id: l.producto_id, descripcion: l.descripcion,
        cantidad: l.cantidad, costo_unitario: l.costo_unitario,
        total: round2(l.cantidad * l.costo_unitario),
      })),
    )
    if (linErr) return { ok: false, error: linErr.message }

    revalidatePath('/portal/compras')
    revalidatePath(`/portal/compras/${compra_id_form}`)
    return { ok: true, compra_id: compra_id_form }
  }

  // ── Crear ──
  if (!await monedaValida(db, session.client_id, moneda)) {
    return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
  }
  const compra_id = generarCompraId()
  let numero: string
  try {
    numero = await siguienteNumeroCompra(db, session.client_id, empresa_id, new Date(fecha).getFullYear())
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de numeración.' }
  }

  const { error: cErr } = await db.from('compras').insert({
    compra_id, numero, client_id: session.client_id, empresa_id,
    proveedor_id, almacen_id, fecha, moneda, estado: 'BORRADOR', total, notas,
    updated_at: new Date().toISOString(),
  })
  if (cErr) return { ok: false, error: cErr.message }

  const { error: linErr } = await db.from('compra_lineas').insert(
    lineas.map((l, i) => ({
      compra_id, client_id: session.client_id, orden: i,
      producto_id: l.producto_id, descripcion: l.descripcion,
      cantidad: l.cantidad, costo_unitario: l.costo_unitario,
      total: l.cantidad * l.costo_unitario,
    })),
  )
  if (linErr) {
    await db.from('compras').delete().eq('compra_id', compra_id).eq('client_id', session.client_id)
    return { ok: false, error: linErr.message }
  }

  revalidatePath('/portal/compras')
  return { ok: true, compra_id }
}

// ── Confirmar: sube stock + crea GASTO 'Compras' (atómico vía Postgres) ─────────
// Todo ocurre en una sola transacción (inv_confirmar_compra): si algo falla,
// ROLLBACK total. Los servicios de las líneas no generan stock pero sí cuentan
// en el gasto. Concurrencia segura (incrementos atómicos).

export async function confirmarCompra(compra_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db.rpc('inv_confirmar_compra', {
    p_compra_id: compra_id, p_client_id: session.client_id,
  })
  if (error) return { ok: false, error: traducirErrorInventario(error.message) }

  revalidatePath('/portal/compras')
  revalidatePath(`/portal/compras/${compra_id}`)
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/inventario')
  revalidatePath('/portal/productos')
  revalidarFinanzas()
  return { ok: true }
}

// ── Anular: revierte stock + elimina el gasto y sus pagos (atómico) ─────────────

export async function anularCompra(compra_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db.rpc('inv_anular_compra', {
    p_compra_id: compra_id, p_client_id: session.client_id,
  })
  if (error) return { ok: false, error: traducirErrorInventario(error.message) }

  revalidatePath('/portal/compras')
  revalidatePath(`/portal/compras/${compra_id}`)
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/inventario')
  revalidatePath('/portal/productos')
  revalidarFinanzas()
  return { ok: true }
}

// ── Eliminar borrador ────────────────────────────────────────────────────────────

export async function eliminarCompra(compra_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: compra } = await db.from('compras')
    .select('estado').eq('compra_id', compra_id).eq('client_id', session.client_id).single()
  if (!compra)                      return { ok: false, error: 'Compra no encontrada.' }
  if (compra.estado !== 'BORRADOR') {
    // Configurador (modo configuración): puede forzar el borrado. Si está CONFIRMADA,
    // primero ANULA (RPC atómica: revierte stock + elimina gasto y sus pagos) para no
    // dejar el ecosistema descuadrado; luego se borra el registro. El usuario normal
    // mantiene la regla de siempre (solo borradores; las confirmadas se anulan).
    if (!session.imp) return { ok: false, error: 'Solo se pueden eliminar borradores. Anula las compras confirmadas.' }
    if (compra.estado === 'CONFIRMADA') {
      const { error: anulErr } = await db.rpc('inv_anular_compra', {
        p_compra_id: compra_id, p_client_id: session.client_id,
      })
      if (anulErr) return { ok: false, error: traducirErrorInventario(anulErr.message) }
    }
  }

  await db.from('compra_lineas').delete().eq('compra_id', compra_id).eq('client_id', session.client_id)
  const { error } = await db.from('compras').delete()
    .eq('compra_id', compra_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/compras')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/inventario')
  revalidarFinanzas()
  return { ok: true }
}

// ── Acciones en lote ──────────────────────────────────────────────────────────
//
// Reutilizan las acciones individuales (misma validación de gating, dueño y
// efectos: eliminar solo borra borradores; anular revierte stock + elimina el
// gasto y sus pagos de forma atómica). La capa de lote solo decide la
// ELEGIBILIDAD por estado — aplica a las válidas y reporta las omitidas con su
// número y motivo. Gating INLINE en cada acción para que audit-gating lo vea.

export interface ResultadoLote {
  hechas:   number
  omitidas: { etiqueta: string; motivo: string }[]
  errores:  { etiqueta: string; error: string }[]
  error?:   string   // fallo global (sesión / permiso)
}

function loteVacio(error?: string): ResultadoLote {
  return { hechas: 0, omitidas: [], errores: [], error }
}

// ── Eliminar en lote (solo borradores) ────────────────────────────────────────

export async function eliminarComprasEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('inventario'))) return loteVacio('No tienes permiso para editar en este módulo.')

  const db = createAdminClient()
  const { data: docs } = await db.from('compras')
    .select('compra_id, numero, estado')
    .eq('client_id', session.client_id).in('compra_id', ids)

  const res = loteVacio()
  for (const d of (docs ?? []) as { compra_id: string; numero: string; estado: EstadoCompra }[]) {
    if (d.estado !== 'BORRADOR') {
      res.omitidas.push({ etiqueta: d.numero, motivo: 'no es borrador (anúlala primero)' }); continue
    }
    const r = await eliminarCompra(d.compra_id)
    if (r.ok) res.hechas++
    else res.errores.push({ etiqueta: d.numero, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/compras')
  return res
}

// ── Anular en lote (SECUENCIAL: revierte stock + elimina gasto en cadena) ──────

export async function anularComprasEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('inventario'))) return loteVacio('No tienes permiso para editar en este módulo.')

  const db = createAdminClient()
  const { data: docs } = await db.from('compras')
    .select('compra_id, numero, estado')
    .eq('client_id', session.client_id).in('compra_id', ids)

  const res = loteVacio()
  for (const d of (docs ?? []) as { compra_id: string; numero: string; estado: EstadoCompra }[]) {
    if (d.estado === 'ANULADA')  { res.omitidas.push({ etiqueta: d.numero, motivo: 'ya anulada' });         continue }
    if (d.estado === 'BORRADOR') { res.omitidas.push({ etiqueta: d.numero, motivo: 'aún no confirmada' });  continue }
    const r = await anularCompra(d.compra_id)   // secuencial a propósito (efecto en cadena: stock + gasto)
    if (r.ok) res.hechas++
    else res.errores.push({ etiqueta: d.numero, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/compras')
  revalidarFinanzas()
  return res
}
