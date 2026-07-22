// Núcleo de la facturación del período, SIN sesión: lo comparten la pestaña del portal
// (`actions/portal/suscripciones.ts`) y el cron diario de facturación automática.
// Mismo motivo que `lib/ventas/factura-core.ts`: en un fichero `'use server'` esto
// sería un endpoint al que se le puede pasar el `client_id` que uno quiera.
//
// Idempotencia en dos capas, y las dos hacen falta:
//   (a) al facturar se avanza `fecha_proximo_cobro`;
//   (b) cada línea guarda su `suscripcion_id`, así que un período ya facturado no se
//       vuelve a ofrecer aunque la fecha se haya movido a mano.
// Por eso la factura se fecha DENTRO del período y las ANULADAS no cuentan. Sin
// prorrateo en la v1.

import { crearFacturaBorrador } from '@/lib/ventas/factura-core'
import {
  estadoEfectivo, sumarPeriodo, calcularCobro, hoyStr,
  type PeriodicidadSub, type EstadoSub, type DescuentoModo,
  type FacturacionPreview, type FacturacionGrupo, type FacturacionLinea, type FacturaDelPeriodo,
  type CalendarioFacturacion, type MesCalendario, type EstadoCobro,
} from '@/lib/suscripciones'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

interface SubFila {
  suscripcion_id: string; cliente_id: string
  moneda: string; periodicidad: string
  fecha_fin: string | null; renovacion_automatica: boolean; estado: string
  fecha_proximo_cobro: string
}

interface LineaFila {
  linea_id: string; suscripcion_id: string; producto_id: string
  precio_mensual: number | string
  descuento_modo: string; descuento_valor: number | string
}

/** Las líneas de cada acuerdo, agrupadas. Un acuerdo sin líneas no se cobra. */
async function lineasDe(db: Db, clientId: string, suscripcionIds: string[]): Promise<Map<string, LineaFila[]>> {
  const mapa = new Map<string, LineaFila[]>()
  if (!suscripcionIds.length) return mapa
  const { data } = await db.from('suscripcion_lineas')
    .select('linea_id, suscripcion_id, producto_id, precio_mensual, descuento_modo, descuento_valor')
    .eq('client_id', clientId).in('suscripcion_id', suscripcionIds)
  for (const l of (data ?? []) as LineaFila[]) {
    const arr = mapa.get(l.suscripcion_id) ?? []
    arr.push(l)
    mapa.set(l.suscripcion_id, arr)
  }
  return mapa
}

/**
 * Reparte el cobro del acuerdo entre sus servicios.
 *
 * El precio es de cada línea; el descuento es del ACUERDO, así que se aplica como
 * porcentaje efectivo (descuento/bruto) sobre cada una: es exacto —el porcentaje se
 * distribuye— y además deja el descuento visible en cada línea de la factura en vez de
 * escondido en un total que no cuadra con la suma de arriba.
 */
function repartirCobro(
  lineas: LineaFila[], nomProd: Map<string, string>,
  periodicidad: PeriodicidadSub,
): { lineas: FacturacionLinea[]; total: number } {
  let total = 0
  const out: FacturacionLinea[] = lineas.map(l => {
    // El descuento es de CADA servicio (mig. 125): cada línea calcula el suyo. A la
    // factura viaja como porcentaje efectivo (descuento/bruto), así un descuento en
    // monto fijo también queda a la vista como % en su propia línea.
    const c   = calcularCobro(Number(l.precio_mensual) || 0, periodicidad,
      l.descuento_modo as DescuentoModo, Number(l.descuento_valor) || 0)
    const pct = c.bruto > 0 ? (c.descuento / c.bruto) * 100 : 0
    total += c.total
    return {
      suscripcion_id: l.suscripcion_id, linea_id: l.linea_id, producto_id: l.producto_id,
      servicio_nombre: nomProd.get(l.producto_id) ?? '—',
      cantidad: 1, precio: c.total,
      meses: c.meses, bruto: c.bruto, descuento: c.descuento, descuento_pct: pct,
      periodicidad,
    }
  })
  return { lineas: out, total: redondear2(total) }
}

function redondear2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/** Primer y último día del período 'YYYY-MM'. */
export function rangoPeriodo(periodo: string): { inicio: string; fin: string } {
  const [y, m] = periodo.split('-').map(Number)
  return {
    inicio: `${periodo}-01`,
    fin:    new Date(Date.UTC(y, m, 0)).toISOString().split('T')[0],   // último día del mes
  }
}

export async function construirPreview(
  db: Db, clientId: string, empresa_id: string, periodo: string,
): Promise<{ ok: boolean; error?: string; preview?: FacturacionPreview }> {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return { ok: false, error: 'Período inválido.' }
  if (!empresa_id) return { ok: false, error: 'Elige una empresa.' }

  const { inicio, fin } = rangoPeriodo(periodo)
  const hoy = hoyStr()

  // Las dos consultas de partida van juntas: lo que TOCA cobrar y lo que YA se cobró en
  // el período. La segunda ya no se puede saltar cuando no queda nada pendiente — es
  // justo el caso «ya está todo facturado», el que hay que poder enseñar.
  const [{ data, error: errSubs }, { data: facs, error: errFacs }] = await Promise.all([
    // Un período contiene SOLO sus cobros (`gte inicio`), no todo lo vencido hasta su
    // fin. Sin ese suelo, una suscripción atrasada desde mayo se colaba en la factura de
    // julio como si fuera de julio: se cobraba un ciclo, la fecha avanzaba uno, y los
    // otros dos meses de atraso seguían ahí sin que nada lo dijera. Ahora cada ciclo
    // pendiente se factura en SU mes, que es como lo enseña el calendario.
    db.from('suscripciones')
      .select('suscripcion_id, cliente_id, moneda, periodicidad, fecha_fin, renovacion_automatica, estado, fecha_proximo_cobro')
      .eq('client_id', clientId).eq('empresa_id', empresa_id).eq('estado', 'ACTIVA')
      .gte('fecha_proximo_cobro', inicio).lte('fecha_proximo_cobro', fin),
    db.from('facturas').select('factura_id, numero, estado, moneda, total, cliente_id')
      .eq('client_id', clientId).eq('empresa_id', empresa_id)
      .neq('estado', 'ANULADA')
      .gte('fecha_emision', inicio).lte('fecha_emision', fin),
  ])
  // Una consulta rota aquí NO puede pasar por «no hay nada que facturar»: esta es
  // la lista de lo que se va a cobrar, y quedarse callada es perder el cobro.
  if (errSubs) return { ok: false, error: `No se pudieron leer las suscripciones: ${errSubs.message}` }
  if (errFacs) return { ok: false, error: `No se pudieron leer las facturas del período: ${errFacs.message}` }

  // Solo ACTIVAS efectivas: una vencida de fin fijo no se cobra.
  let subs = ((data ?? []) as SubFila[]).filter(s =>
    estadoEfectivo({ estado: s.estado as EstadoSub, fecha_fin: s.fecha_fin, renovacion_automatica: s.renovacion_automatica }, hoy) === 'ACTIVA')

  // Idempotencia: excluir las que ya tienen línea en una factura VIVA del período.
  // Las ANULADAS no cuentan — anular es deshacer, y al anular se retrocede también el
  // `fecha_proximo_cobro` (ver cambiarEstadoFactura), así el período vuelve a facturarse.
  type FacFila = { factura_id: string; numero: string; estado: string; moneda: string; total: number | string; cliente_id: string }
  const facturas = (facs ?? []) as FacFila[]
  const porFactura = new Map<string, number>()
  if (facturas.length) {
    const { data: lins } = await db.from('documento_lineas')
      .select('documento_id, suscripcion_id').eq('documento_tipo', 'FACTURA')
      .in('documento_id', facturas.map(f => f.factura_id)).not('suscripcion_id', 'is', null)
    const ya = new Set<string>()
    for (const l of (lins ?? []) as { documento_id: string; suscripcion_id: string }[]) {
      ya.add(l.suscripcion_id)
      porFactura.set(l.documento_id, (porFactura.get(l.documento_id) ?? 0) + 1)
    }
    subs = subs.filter(s => !ya.has(s.suscripcion_id))
  }
  // Solo las facturas que cubren suscripciones: una venta suelta del mes no pinta aquí.
  const conSuscripciones = facturas.filter(f => porFactura.has(f.factura_id))

  // Las líneas del acuerdo (mig. 124): de ahí salen los servicios y sus precios.
  const porSub  = await lineasDe(db, clientId, subs.map(s => s.suscripcion_id))
  const cliIds  = [...new Set([...subs.map(s => s.cliente_id), ...conSuscripciones.map(f => f.cliente_id)])]
  const prodIds = [...new Set([...porSub.values()].flat().map(l => l.producto_id))]
  const [{ data: cli }, { data: prod }] = await Promise.all([
    cliIds.length  ? db.from('third_parties').select('tercero_id, nombre').in('tercero_id', cliIds)  : Promise.resolve({ data: [] }),
    prodIds.length ? db.from('products').select('producto_id, nombre').in('producto_id', prodIds) : Promise.resolve({ data: [] }),
  ])
  const nomCli  = new Map(((cli ?? []) as { tercero_id: string; nombre: string }[]).map(c => [c.tercero_id, c.nombre]))
  const nomProd = new Map(((prod ?? []) as { producto_id: string; nombre: string }[]).map(p => [p.producto_id, p.nombre]))

  const yaFacturadas: FacturaDelPeriodo[] = conSuscripciones
    .map(f => ({
      factura_id:     f.factura_id,
      numero:         f.numero,
      cliente_nombre: nomCli.get(f.cliente_id) ?? '—',
      moneda:         f.moneda,
      total:          Number(f.total) || 0,
      estado:         f.estado,
      suscripciones:  porFactura.get(f.factura_id) ?? 0,
    }))
    .sort((a, b) => a.numero.localeCompare(b.numero))

  const vacio: FacturacionPreview = { periodo, empresa_id, grupos: [], clientesMultimoneda: [], yaFacturadas }
  if (!subs.length) return { ok: true, preview: vacio }

  const mapa = new Map<string, FacturacionGrupo>()
  const monedasPorCliente = new Map<string, Set<string>>()
  for (const s of subs) {
    const suyas = porSub.get(s.suscripcion_id) ?? []
    if (!suyas.length) continue   // acuerdo sin servicios: no hay nada que cobrar

    const key = `${s.cliente_id}#${s.moneda}`
    let g = mapa.get(key)
    if (!g) {
      g = { cliente_id: s.cliente_id, cliente_nombre: nomCli.get(s.cliente_id) ?? '—', moneda: s.moneda, lineas: [], total: 0 }
      mapa.set(key, g)
    }
    // Una línea de factura por servicio; el descuento del acuerdo se reparte entre ellas.
    const reparto = repartirCobro(suyas, nomProd, s.periodicidad as PeriodicidadSub)
    g.lineas.push(...reparto.lineas)
    g.total = redondear2(g.total + reparto.total)
    if (!monedasPorCliente.has(s.cliente_id)) monedasPorCliente.set(s.cliente_id, new Set())
    monedasPorCliente.get(s.cliente_id)!.add(s.moneda)
  }
  const clientesMultimoneda = [...monedasPorCliente.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([id]) => nomCli.get(id) ?? id)

  const grupos = [...mapa.values()].sort((a, b) => a.cliente_nombre.localeCompare(b.cliente_nombre))
  return { ok: true, preview: { periodo, empresa_id, grupos, clientesMultimoneda, yaFacturadas } }
}

// ── Calendario de cobros ──────────────────────────────────────────────────────

/** Suma meses a un 'YYYY-MM'. */
function sumarMeses(periodo: string, n: number): string {
  const [y, m] = periodo.split('-').map(Number)
  const d = new Date(Date.UTC(y, (m - 1) + n, 1))
  return d.toISOString().slice(0, 7)
}

/**
 * Todo el cobro recurrente de una empresa a lo largo del tiempo: lo atrasado, lo de este
 * mes, lo ya facturado y lo que viene.
 *
 * Sustituye al selector de mes, que obligaba a ir mes a mes para enterarse de nada y
 * —peor— escondía los atrasos: una suscripción vencida hacía meses se colaba en el mes que
 * estuvieras mirando como si fuera de ese mes.
 *
 * **El futuro es solo informativo.** Se proyecta con aritmética pura (`sumarPeriodo` sobre
 * `fecha_proximo_cobro`), no escribe nada y no se puede facturar: no existe hasta que se
 * genere su borrador. Y es una ESTIMACIÓN, no una deuda — el cliente puede pausar,
 * cancelar o renegociar, así que no se suma como ingreso en ningún sitio.
 */
export async function construirCalendario(
  db: Db, clientId: string, empresa_id: string,
  hoy = hoyStr(), mesesFuturo = 12,
): Promise<{ ok: boolean; error?: string; calendario?: CalendarioFacturacion }> {
  if (!empresa_id) return { ok: false, error: 'Elige una empresa.' }

  const mesActual = hoy.slice(0, 7)
  const mesHasta  = sumarMeses(mesActual, mesesFuturo)

  // Sin `descuento_*`: el descuento es de cada LÍNEA desde la mig. 125, que borró
  // esas columnas de `suscripciones`. Pedirlas aquí hacía fallar la consulta
  // entera y, como el error se tragaba, el calendario decía «no hay cobros» con
  // el negocio lleno de suscripciones activas. De ahí que el `error` se mire.
  const { data: subsRaw, error: errSubs } = await db.from('suscripciones')
    .select('suscripcion_id, cliente_id, moneda, periodicidad, fecha_fin, renovacion_automatica, estado, fecha_proximo_cobro')
    .eq('client_id', clientId).eq('empresa_id', empresa_id).eq('estado', 'ACTIVA')
  if (errSubs) return { ok: false, error: `No se pudieron leer las suscripciones: ${errSubs.message}` }

  // Solo ACTIVAS efectivas: una vencida de fin fijo no se proyecta.
  const subs = ((subsRaw ?? []) as SubFila[]).filter(s =>
    estadoEfectivo({ estado: s.estado as EstadoSub, fecha_fin: s.fecha_fin, renovacion_automatica: s.renovacion_automatica }, hoy) === 'ACTIVA')

  // La ventana arranca en el cobro pendiente más antiguo: si algo lleva tres meses sin
  // cobrarse, tiene que verse, no quedarse detrás del borde de la pantalla.
  const mesDesde = subs.reduce(
    (min, s) => (s.fecha_proximo_cobro.slice(0, 7) < min ? s.fecha_proximo_cobro.slice(0, 7) : min),
    mesActual)

  const { inicio } = rangoPeriodo(mesDesde)
  const { fin }    = rangoPeriodo(mesHasta)

  // Facturas VIVAS de la ventana y sus líneas de suscripción. Sirven para dos cosas: para
  // enseñar lo ya facturado y para no volver a ofrecer un ciclo cuya factura existe
  // aunque alguien haya movido la fecha a mano (la idempotencia de dos capas).
  const { data: facs } = await db.from('facturas')
    .select('factura_id, numero, estado, moneda, total, cliente_id, fecha_emision')
    .eq('client_id', clientId).eq('empresa_id', empresa_id)
    .neq('estado', 'ANULADA')
    .gte('fecha_emision', inicio).lte('fecha_emision', fin)

  type FacFila = {
    factura_id: string; numero: string; estado: string; moneda: string
    total: number | string; cliente_id: string; fecha_emision: string
  }
  const facturas = (facs ?? []) as FacFila[]
  const porFactura   = new Map<string, number>()
  const yaFacturado  = new Set<string>()          // `${suscripcion_id}@${periodo}`
  if (facturas.length) {
    const periodoDe = new Map(facturas.map(f => [f.factura_id, f.fecha_emision.slice(0, 7)]))
    const { data: lins } = await db.from('documento_lineas')
      .select('documento_id, suscripcion_id').eq('documento_tipo', 'FACTURA')
      .in('documento_id', facturas.map(f => f.factura_id)).not('suscripcion_id', 'is', null)
    for (const l of (lins ?? []) as { documento_id: string; suscripcion_id: string }[]) {
      porFactura.set(l.documento_id, (porFactura.get(l.documento_id) ?? 0) + 1)
      yaFacturado.add(`${l.suscripcion_id}@${periodoDe.get(l.documento_id)}`)
    }
  }
  const conSuscripciones = facturas.filter(f => porFactura.has(f.factura_id))

  const porSub  = await lineasDe(db, clientId, subs.map(s => s.suscripcion_id))
  const cliIds  = [...new Set([...subs.map(s => s.cliente_id), ...conSuscripciones.map(f => f.cliente_id)])]
  const prodIds = [...new Set([...porSub.values()].flat().map(l => l.producto_id))]
  const [{ data: cli }, { data: prod }] = await Promise.all([
    cliIds.length  ? db.from('third_parties').select('tercero_id, nombre').in('tercero_id', cliIds) : Promise.resolve({ data: [] }),
    prodIds.length ? db.from('products').select('producto_id, nombre').in('producto_id', prodIds)   : Promise.resolve({ data: [] }),
  ])
  const nomCli  = new Map(((cli ?? []) as { tercero_id: string; nombre: string }[]).map(c => [c.tercero_id, c.nombre]))
  const nomProd = new Map(((prod ?? []) as { producto_id: string; nombre: string }[]).map(p => [p.producto_id, p.nombre]))

  // ── Proyección: cada ciclo en SU mes ──
  interface Bucket {
    grupos: Map<string, FacturacionGrupo>
    monedasPorCliente: Map<string, Set<string>>
    hayPendiente: boolean
  }
  const buckets = new Map<string, Bucket>()
  const bucketDe = (periodo: string): Bucket => {
    let b = buckets.get(periodo)
    if (!b) { b = { grupos: new Map(), monedasPorCliente: new Map(), hayPendiente: false }; buckets.set(periodo, b) }
    return b
  }

  for (const s of subs) {
    const suyas = porSub.get(s.suscripcion_id) ?? []
    if (!suyas.length) continue   // acuerdo sin servicios: no hay nada que proyectar

    const per = s.periodicidad as PeriodicidadSub
    // El reparto es el mismo en todos los ciclos, así que se calcula UNA vez y se
    // reutiliza: proyectar 12 meses no puede repetir la aritmética doce veces.
    const reparto = repartirCobro(suyas, nomProd, per)

    let fecha = s.fecha_proximo_cobro
    // Tope duro además del de la fecha: una MENSUAL da 13 vueltas, pero un dato corrupto
    // (periodicidad rara, fecha imposible) no puede colgar el bucle.
    for (let i = 0; i < 200 && fecha <= fin; i++) {
      // Vigencia con fin fijo y sin renovación: no se proyecta más allá del fin.
      if (s.fecha_fin && !s.renovacion_automatica && fecha > s.fecha_fin) break

      const periodo = fecha.slice(0, 7)
      if (!yaFacturado.has(`${s.suscripcion_id}@${periodo}`)) {
        const b   = bucketDe(periodo)
        const key = `${s.cliente_id}#${s.moneda}`
        let g = b.grupos.get(key)
        if (!g) {
          g = { cliente_id: s.cliente_id, cliente_nombre: nomCli.get(s.cliente_id) ?? '—', moneda: s.moneda, lineas: [], total: 0 }
          b.grupos.set(key, g)
        }
        g.lineas.push(...reparto.lineas)
        g.total = redondear2(g.total + reparto.total)
        if (!b.monedasPorCliente.has(s.cliente_id)) b.monedasPorCliente.set(s.cliente_id, new Set())
        b.monedasPorCliente.get(s.cliente_id)!.add(s.moneda)
        if (periodo <= mesActual) b.hayPendiente = true
      }
      fecha = sumarPeriodo(fecha, per)
    }
  }

  // Las facturas también crean su mes: un mes cerrado no tiene cobros pendientes, pero
  // hay que poder verlo.
  const facturasPorMes = new Map<string, FacturaDelPeriodo[]>()
  for (const f of conSuscripciones) {
    const periodo = f.fecha_emision.slice(0, 7)
    const arr = facturasPorMes.get(periodo) ?? []
    arr.push({
      factura_id:     f.factura_id,
      numero:         f.numero,
      cliente_nombre: nomCli.get(f.cliente_id) ?? '—',
      moneda:         f.moneda,
      total:          Number(f.total) || 0,
      estado:         f.estado,
      suscripciones:  porFactura.get(f.factura_id) ?? 0,
    })
    facturasPorMes.set(periodo, arr)
  }

  const periodos = [...new Set([...buckets.keys(), ...facturasPorMes.keys()])].sort()

  const meses: MesCalendario[] = periodos.map(periodo => {
    const b        = buckets.get(periodo)
    const grupos   = [...(b?.grupos.values() ?? [])].sort((x, y) => x.cliente_nombre.localeCompare(y.cliente_nombre))
    const facturas = (facturasPorMes.get(periodo) ?? []).sort((x, y) => x.numero.localeCompare(y.numero))

    // Un total por moneda, contando lo pendiente Y lo ya facturado del mes: la pregunta
    // que se hace el dueño es «cuánto entra en julio», no «cuánto me queda por generar».
    const porMoneda = new Map<string, number>()
    for (const g of grupos)   porMoneda.set(g.moneda, (porMoneda.get(g.moneda) ?? 0) + g.total)
    for (const f of facturas) porMoneda.set(f.moneda, (porMoneda.get(f.moneda) ?? 0) + f.total)

    const estado: EstadoCobro = b?.hayPendiente ? 'PENDIENTE'
      : facturas.length       ? 'FACTURADO'
      : 'PROYECTADO'

    return {
      periodo, estado, grupos, facturas,
      totales: [...porMoneda.entries()].map(([moneda, total]) => ({ moneda, total })),
      clientesMultimoneda: [...(b?.monedasPorCliente.entries() ?? [])]
        .filter(([, set]) => set.size > 1)
        .map(([id]) => nomCli.get(id) ?? id),
    }
  })

  return { ok: true, calendario: { empresa_id, mesActual, meses } }
}

export interface ResultadoFacturacion {
  ok: boolean; error?: string; generadas?: number; fallidas?: number
  /** Números de lo creado, para poder nombrarlo al usuario («Borrador FA20260013»). */
  numeros?: string[]
}

/**
 * Genera las facturas BORRADOR del período. `excluir` = claves "clienteId#moneda".
 *
 * Quien llama ya ha comprobado permisos y que la empresa tiene letra de facturación.
 */
export async function generarFacturasPeriodo(
  db: Db, clientId: string, empresa_id: string, letra: string, periodo: string,
  excluir: string[] = [],
): Promise<ResultadoFacturacion> {
  // La letra ya no se usa para numerar (eso pasó a la emisión), pero se sigue exigiendo:
  // generar borradores para una empresa que nunca podrá emitirlos es trabajo muerto.
  if (!letra) return { ok: false, error: 'La empresa no tiene letra de facturación.' }

  const res = await construirPreview(db, clientId, empresa_id, periodo)
  if (!res.ok || !res.preview) return { ok: false, error: res.error ?? 'No se pudo preparar la facturación.' }

  const excluidos = new Set(excluir)
  const grupos = res.preview.grupos.filter(g => !excluidos.has(`${g.cliente_id}#${g.moneda}`))
  if (!grupos.length) return { ok: true, generadas: 0, fallidas: 0 }

  // La factura se fecha DENTRO del período, no «hoy»: la defensa por rastro busca las
  // facturas del período, así que cerrar junio en julio dejaría la factura fuera de la
  // ventana y el rastro invisible. Si hoy cae dentro, se usa hoy.
  const { inicio, fin } = rangoPeriodo(periodo)
  const hoy = hoyStr()
  const fecha_emision = hoy < inicio ? inicio : hoy > fin ? fin : hoy

  let generadas = 0, fallidas = 0
  let primerError: string | undefined
  const numeros: string[] = []

  for (const g of grupos) {
    // La descripción explica el importe: una línea de 27.000 sin decir que son tres
    // meses con un 10 % de rebaja obliga al cliente a llamar para preguntar.
    const lineas = g.lineas.map(l => {
      const partes = [l.servicio_nombre]
      if (l.meses > 1) partes.push(`${l.meses} meses`)
      return {
        producto_id:     l.producto_id,
        descripcion:     partes.join(' · '),
        cantidad:        1,
        // Bruto + descuento en la línea, no el neto pelado: así la factura enseña la
        // rebaja pactada en vez de esconderla en un precio que no cuadra con la tarifa.
        precio_unitario: l.bruto,
        descuento_pct:   l.descuento_pct,
        suscripcion_id:  l.suscripcion_id,
      }
    })

    const datos = {
      client_id: clientId, empresa_id,
      cliente_id: g.cliente_id, moneda: g.moneda, fecha_emision,
      condicion_pago: 'CONTADO',
      notas_internas: `Facturación de suscripciones — ${periodo}`,
      lineas,
    }

    // El borrador ya no reserva correlativo (el número llega al emitir), así que el
    // choque de numeración que este bucle provocaba desapareció. El reintento se queda
    // por lo que sí puede fallar de forma transitoria: la escritura misma.
    let r = await crearFacturaBorrador(db, datos)
    if (!r.ok) r = await crearFacturaBorrador(db, datos)
    if (!r.ok) { fallidas++; primerError ??= r.error; continue }
    numeros.push(r.numero)

    // Avanzar el próximo cobro de cada suscripción facturada (defensa de idempotencia).
    for (const l of g.lineas) {
      const { data: s } = await db.from('suscripciones')
        .select('fecha_proximo_cobro, periodicidad')
        .eq('suscripcion_id', l.suscripcion_id).eq('client_id', clientId).maybeSingle()
      if (!s) continue
      await db.from('suscripciones').update({
        fecha_proximo_cobro: sumarPeriodo(s.fecha_proximo_cobro as string, s.periodicidad as PeriodicidadSub),
        updated_at: new Date().toISOString(),
      }).eq('suscripcion_id', l.suscripcion_id).eq('client_id', clientId)
    }
    generadas++
  }

  return { ok: true, generadas, fallidas, numeros, error: fallidas ? primerError : undefined }
}

/**
 * Facturación AUTOMÁTICA del cron: deja hechos los borradores de lo que toca cobrar
 * hasta hoy, en TODA empresa que pueda numerar facturas.
 *
 * No hay interruptor y no debe haberlo: un cobro pactado que vence no es una decisión,
 * y el borrador no compromete a nada —no se emite ni se envía, se revisa y se emite—.
 * El único requisito es la letra de facturación, porque sin ella no hay con qué numerar.
 * Quien quiera adelantarse tiene el botón de Suscripciones → «Facturación del período».
 *
 * El período que se factura es el del PRÓXIMO COBRO, no el mes en curso: una anual que
 * vence hoy pertenece a este mes, pero una mensual atrasada desde mayo hay que cerrarla
 * en mayo para que su rastro caiga en la ventana correcta.
 */
export async function facturarAutomatico(
  db: Db, clientIds: string[], hoy: string,
): Promise<number> {
  if (!clientIds.length) return 0

  const { data: empresas } = await db.from('empresas')
    .select('empresa_id, client_id, letra_facturacion')
    .in('client_id', clientIds)
    .not('letra_facturacion', 'is', null)

  let generadas = 0
  for (const e of (empresas ?? []) as { empresa_id: string; client_id: string; letra_facturacion: string }[]) {
    // Qué períodos hay pendientes en esta empresa (normalmente uno).
    const { data: pend } = await db.from('suscripciones')
      .select('fecha_proximo_cobro')
      .eq('client_id', e.client_id).eq('empresa_id', e.empresa_id)
      .eq('estado', 'ACTIVA')
      .lte('fecha_proximo_cobro', hoy)

    const periodos = [...new Set(((pend ?? []) as { fecha_proximo_cobro: string }[])
      .map(p => p.fecha_proximo_cobro.slice(0, 7)))].sort()

    for (const periodo of periodos) {
      const r = await generarFacturasPeriodo(db, e.client_id, e.empresa_id, e.letra_facturacion, periodo)
      generadas += r.generadas ?? 0
    }
  }
  return generadas
}
