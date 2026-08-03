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
import { estadoCobro, EPS_SALDO } from '@/lib/cobranza-core'
import {
  estadoEfectivo, sumarPeriodo, calcularCobro, hoyStr, cicloVigente, fraccionProrrateo,
  type PeriodicidadSub, type EstadoSub, type DescuentoModo,
  type FacturacionPreview, type FacturacionGrupo, type FacturacionLinea, type FacturaDelPeriodo,
  type CalendarioFacturacion, type MesCalendario, type EstadoCobro, type TotalMes,
  type FacturaDeAcuerdo,
} from '@/lib/suscripciones'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

interface SubFila {
  suscripcion_id: string; cliente_id: string
  moneda: string; periodicidad: string
  fecha_fin: string | null; renovacion_automatica: boolean; estado: string
  fecha_proximo_cobro: string
  /** Para el prorrateo del PRIMER período (mig. 163). */
  fecha_inicio?: string
  prorratear?: boolean
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
  /** Prorrateo del PRIMER período (mig. 163): 1 = ciclo completo, que es lo normal. */
  prorrateo?: { fraccion: number; diasCobrados: number; diasCiclo: number },
): { lineas: FacturacionLinea[]; total: number } {
  let total = 0
  const out: FacturacionLinea[] = lineas.map(l => {
    // El descuento es de CADA servicio (mig. 125): cada línea calcula el suyo. A la
    // factura viaja como porcentaje efectivo (descuento/bruto), así un descuento en
    // monto fijo también queda a la vista como % en su propia línea.
    const base = calcularCobro(Number(l.precio_mensual) || 0, periodicidad,
      l.descuento_modo as DescuentoModo, Number(l.descuento_valor) || 0)
    // El prorrateo escala el ciclo entero (bruto y descuento a la vez): si se aplicara
    // solo al bruto, la rebaja pactada saldría multiplicada respecto de lo cobrado.
    const f = prorrateo && prorrateo.fraccion < 1 ? prorrateo.fraccion : 1
    const c = f === 1 ? base : {
      ...base,
      bruto:     redondear2(base.bruto * f),
      descuento: redondear2(base.descuento * f),
      total:     redondear2(base.total * f),
    }
    const pct = c.bruto > 0 ? (c.descuento / c.bruto) * 100 : 0
    total += c.total
    return {
      suscripcion_id: l.suscripcion_id, linea_id: l.linea_id, producto_id: l.producto_id,
      // La línea DICE que va prorrateada: un importe raro sin explicación obliga al
      // cliente a llamar para preguntar.
      servicio_nombre: (nomProd.get(l.producto_id) ?? '—')
        + (f === 1 ? '' : ` · ${prorrateo!.diasCobrados} de ${prorrateo!.diasCiclo} días`),
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

/** Una factura VIVA de la ventana, con lo mínimo para contarla y enseñarla. */
export interface FacturaFila {
  factura_id: string; numero: string; estado: string; moneda: string
  total: number | string; cliente_id: string; fecha_emision: string
}

export interface FacturadoPorCiclo {
  /** Las facturas vivas de la ventana (ANULADAS excluidas). */
  facturas:   FacturaFila[]
  /** Saldo pendiente de cada factura (`factura_id` → importe en SU moneda). */
  saldoDe:    Map<string, number>
  /** Cuántas suscripciones cubre cada factura (`factura_id` → nº). */
  porFactura: Map<string, number>
  /** `${suscripcion_id}@${YYYY-MM}` de todo ciclo que YA tiene factura viva. */
  porCiclo:   Set<string>
  /**
   * Mensaje si la consulta falló. Se DEVUELVE en vez de tragarse: un fallo aquí que pase
   * por «no hay nada facturado» hace ofrecer un cobro ya hecho (y al revés, en el
   * escáner, prometer un borrador que no existe).
   */
  error?:     string
}

/**
 * Qué ciclos de qué acuerdos están ya facturados — la capa (b) de la idempotencia.
 *
 * La entidad es la suscripción MÁS SU CICLO, nunca el `suscripcion_id` a secas: con la
 * facturación automática puesta, todo acuerdo con más de un mes de vida tiene alguna
 * línea con su id, así que preguntar «¿tiene factura?» devuelve «sí» para siempre. Es
 * justo el fallo que hacía que el aviso de cobro dijera «factura preparada» desde el segundo mes
 * y enlazara a una factura que no existía.
 *
 * Vive aquí y no copiada en cada consumidor (preview, calendario y el escáner de avisos)
 * porque con una copia por sitio el aviso y el calendario acaban diciendo cosas
 * distintas del mismo cobro — la lección de `aplicarConceptos` y `estadoStock`.
 *
 * El período de un ciclo es el mes de la `fecha_emision` de su factura: la factura se
 * fecha DENTRO del período justamente para que este cruce valga.
 */
export async function facturadasPorCiclo(db: Db, opciones: {
  /** Uno o varios tenants: el escáner de avisos barre todos de una vez. */
  clientIds: string[]
  empresaId?: string
  /** Ventana de `fecha_emision` (inclusive). */
  desde: string
  hasta: string
  /**
   * Acota las líneas a estos acuerdos. Con él, `documento_lineas` se filtra por
   * `suscripcion_id` (unas decenas) en vez de por la lista de facturas de la ventana, que
   * barriendo varios tenants son miles de ids en la URL.
   */
  suscripcionIds?: string[]
}): Promise<FacturadoPorCiclo> {
  const vacio: FacturadoPorCiclo = {
    facturas: [], saldoDe: new Map(), porFactura: new Map(), porCiclo: new Set(),
  }
  if (!opciones.clientIds.length) return vacio

  let q = db.from('facturas')
    .select('factura_id, numero, estado, moneda, total, cliente_id, fecha_emision')
    .in('client_id', opciones.clientIds)
    // Las ANULADAS no cuentan: anular es deshacer, y al anular se retrocede también el
    // `fecha_proximo_cobro`, así que ese ciclo vuelve a estar por cobrar.
    .neq('estado', 'ANULADA')
    .gte('fecha_emision', opciones.desde).lte('fecha_emision', opciones.hasta)
  if (opciones.empresaId) q = q.eq('empresa_id', opciones.empresaId)
  const { data: facs, error: errFacs } = await q
  if (errFacs) return { ...vacio, error: errFacs.message }

  const facturas = (facs ?? []) as FacturaFila[]
  if (!facturas.length) return vacio

  // Lo cobrado de cada factura, en la moneda del DOCUMENTO (`monto_ref`): pagar 100 USD
  // desde una caja en CUP baja el saldo en 100 USD. El saldo sale de `cobranza-core`, que
  // ya lo comparten CxC y el listado de Ventas — una segunda implementación acabaría
  // diciendo otra cosa que la pantalla de cobros.
  const { data: movs } = await db.from('movimientos_tesoreria')
    .select('referencia_id, monto, monto_ref')
    .in('client_id', opciones.clientIds)
    .eq('origen', 'COBRO')
    .in('referencia_id', facturas.map(f => f.factura_id))
  const cobrado = new Map<string, number>()
  for (const m of (movs ?? []) as { referencia_id: string; monto: number; monto_ref: number | null }[]) {
    cobrado.set(m.referencia_id, (cobrado.get(m.referencia_id) ?? 0) + Number(m.monto_ref ?? m.monto))
  }
  const saldoDe = new Map<string, number>()
  for (const f of facturas) {
    // Un BORRADOR no debe nada todavía: no es una cuenta por cobrar hasta que se emite.
    saldoDe.set(f.factura_id, f.estado === 'BORRADOR'
      ? 0
      : estadoCobro(Number(f.total) || 0, cobrado.get(f.factura_id) ?? 0, null, hoyStr()).saldo)
  }

  const periodoDe = new Map(facturas.map(f => [f.factura_id, f.fecha_emision.slice(0, 7)]))
  let lq = db.from('documento_lineas')
    .select('documento_id, suscripcion_id').eq('documento_tipo', 'FACTURA')
    .not('suscripcion_id', 'is', null)
  lq = opciones.suscripcionIds
    ? lq.in('suscripcion_id', opciones.suscripcionIds)
    : lq.in('documento_id', facturas.map(f => f.factura_id))
  const { data: lins, error: errLins } = await lq
  if (errLins) return { ...vacio, error: errLins.message }

  const porFactura = new Map<string, number>()
  const porCiclo   = new Set<string>()
  for (const l of (lins ?? []) as { documento_id: string; suscripcion_id: string }[]) {
    const periodo = periodoDe.get(l.documento_id)
    // Filtrando por `suscripcion_id` entran líneas de facturas fuera de la ventana (o
    // anuladas): las que no están en el mapa no son de una factura viva de aquí.
    if (!periodo) continue
    porFactura.set(l.documento_id, (porFactura.get(l.documento_id) ?? 0) + 1)
    porCiclo.add(`${l.suscripcion_id}@${periodo}`)
  }
  return { facturas, saldoDe, porFactura, porCiclo }
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
  const [{ data, error: errSubs }, facturado] = await Promise.all([
    // Un período contiene SOLO sus cobros (`gte inicio`), no todo lo vencido hasta su
    // fin. Sin ese suelo, una suscripción atrasada desde mayo se colaba en la factura de
    // julio como si fuera de julio: se cobraba un ciclo, la fecha avanzaba uno, y los
    // otros dos meses de atraso seguían ahí sin que nada lo dijera. Ahora cada ciclo
    // pendiente se factura en SU mes, que es como lo enseña el calendario.
    db.from('suscripciones')
      .select('suscripcion_id, cliente_id, moneda, periodicidad, fecha_fin, renovacion_automatica, estado, fecha_proximo_cobro, fecha_inicio, prorratear')
      .eq('client_id', clientId).eq('empresa_id', empresa_id).eq('estado', 'ACTIVA')
      .gte('fecha_proximo_cobro', inicio).lte('fecha_proximo_cobro', fin),
    facturadasPorCiclo(db, { clientIds: [clientId], empresaId: empresa_id, desde: inicio, hasta: fin }),
  ])
  // Una consulta rota aquí NO puede pasar por «no hay nada que facturar»: esta es
  // la lista de lo que se va a cobrar, y quedarse callada es perder el cobro.
  if (errSubs) return { ok: false, error: `No se pudieron leer las suscripciones: ${errSubs.message}` }
  if (facturado.error) return { ok: false, error: `No se pudieron leer las facturas del período: ${facturado.error}` }

  // Solo ACTIVAS efectivas: una vencida de fin fijo no se cobra. Y el CICLO tiene que
  // caer dentro de la vigencia: un acuerdo que termina el 14 no genera el cobro del 15
  // aunque hoy siga vivo (es lo que hace «Cancelar al final del período»). El calendario
  // ya lo comprobaba en su proyección y aquí faltaba, así que las dos pantallas del mismo
  // mes decían cosas distintas — y la que factura era la que se equivocaba.
  let subs = ((data ?? []) as SubFila[]).filter(s =>
    estadoEfectivo({ estado: s.estado as EstadoSub, fecha_fin: s.fecha_fin, renovacion_automatica: s.renovacion_automatica }, hoy) === 'ACTIVA'
    && cicloVigente(s, s.fecha_proximo_cobro))

  // Idempotencia: excluir las que ya tienen línea en una factura VIVA de ESTE ciclo.
  const { facturas, porFactura, porCiclo } = facturado
  subs = subs.filter(s => !porCiclo.has(`${s.suscripcion_id}@${periodo}`))
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
      saldo:          facturado.saldoDe.get(f.factura_id) ?? 0,
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
    //
    // **Solo la PRIMERA factura se prorratea** (mig. 163), y se sabe que es la primera
    // porque el ciclo que se está cobrando es el que contiene la `fecha_inicio`. A partir
    // del segundo cobro la fecha de inicio ya queda atrás y la fracción vale 1.
    const per      = s.periodicidad as PeriodicidadSub
    const prorrata = s.prorratear && s.fecha_inicio
      ? fraccionProrrateo(s.fecha_inicio, s.fecha_proximo_cobro, per)
      : undefined
    const reparto = repartirCobro(suyas, nomProd, per, prorrata)
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
  const { facturas, saldoDe, porFactura, porCiclo: yaFacturado, error: errFacs } = await facturadasPorCiclo(
    db, { clientIds: [clientId], empresaId: empresa_id, desde: inicio, hasta: fin })
  if (errFacs) return { ok: false, error: `No se pudieron leer las facturas: ${errFacs}` }

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
      if (!cicloVigente(s, fecha)) break

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
      saldo:          saldoDe.get(f.factura_id) ?? 0,
    })
    facturasPorMes.set(periodo, arr)
  }

  const periodos = [...new Set([...buckets.keys(), ...facturasPorMes.keys()])].sort()

  const meses: MesCalendario[] = periodos.map(periodo => {
    const b        = buckets.get(periodo)
    const grupos   = [...(b?.grupos.values() ?? [])].sort((x, y) => x.cliente_nombre.localeCompare(y.cliente_nombre))
    const facturas = (facturasPorMes.get(periodo) ?? []).sort((x, y) => x.numero.localeCompare(y.numero))

    // Un total por moneda, DESGLOSADO. La pregunta del dueño es «cuánto entra en julio»,
    // pero la que no podía responder era «¿y cuánto de eso ya está cobrado?»: el mes se
    // ponía verde con 55 borradores sin emitir.
    const porMoneda = new Map<string, TotalMes>()
    const de = (moneda: string): TotalMes => {
      let t = porMoneda.get(moneda)
      if (!t) { t = { moneda, total: 0, facturado: 0, cobrado: 0, pendiente: 0 }; porMoneda.set(moneda, t) }
      return t
    }
    for (const g of grupos) {
      const t = de(g.moneda); t.total += g.total; t.pendiente += g.total
    }
    for (const f of facturas) {
      const t = de(f.moneda)
      t.total += f.total; t.facturado += f.total; t.cobrado += f.total - f.saldo
    }

    // El verde se reserva a lo que TERMINÓ. Mientras quede un borrador, el trabajo que
    // falta es emitir; con saldo vivo, cobrar.
    const hayBorrador = facturas.some(f => f.estado === 'BORRADOR')
    const saldoVivo   = facturas.reduce((s, f) => s + f.saldo, 0)
    const estado: EstadoCobro =
        b?.hayPendiente     ? 'PENDIENTE'
      : !facturas.length    ? 'PROYECTADO'
      : hayBorrador         ? 'BORRADOR'
      : saldoVivo > EPS_SALDO ? 'EMITIDO'
      : 'COBRADO'

    return {
      periodo, estado, grupos, facturas,
      totales: [...porMoneda.values()].map(t => ({
        ...t,
        total:     redondear2(t.total),
        facturado: redondear2(t.facturado),
        cobrado:   redondear2(t.cobrado),
        pendiente: redondear2(t.pendiente),
      })),
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
 * Facturación AUTOMÁTICA del cron: deja hechos los borradores de lo que hay que cobrar
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

// ── Historial de cobro de un acuerdo ─────────────────────────────────────────
//
// Hasta aquí, Suscripciones era un registro de contratos que acababa donde empieza
// Contabilidad: generaba la factura y se olvidaba. Un negocio de cuotas quiere ver
// **quién no ha pagado la mensualidad**, y eso vivía en CxC sin ninguna conexión con el
// acuerdo que lo originó.
//
// No hace falta ninguna columna: la cadena ya existe entera —`suscripciones` →
// `documento_lineas.suscripcion_id` → `facturas` → movimientos con `origen=COBRO`—, que
// es exactamente lo que deriva `cobranza-core`.

// El tipo `FacturaDeAcuerdo` vive en `lib/suscripciones.ts` (puro, lo consume la vista):
//  · `saldo` — lo que falta por cobrar; un BORRADOR no debe nada todavía.
//  · `acuerdos` — cuántos acuerdos cubre la factura. **El saldo NO se reparte entre
//    ellos**: se atribuye al conjunto y la fila lo dice, porque repartirlo sería inventar
//    una imputación que nadie ha hecho.

/**
 * Todas las facturas VIVAS de cada acuerdo, de la más reciente a la más antigua.
 *
 * Las ANULADAS no cuentan —ni como facturado ni como deuda—, que ya es la regla del
 * preview: anular es deshacer, y al anular se retrocede el próximo cobro.
 */
export async function historialPorAcuerdo(
  db: Db, clientId: string, suscripcionIds: string[],
): Promise<Map<string, FacturaDeAcuerdo[]>> {
  const out = new Map<string, FacturaDeAcuerdo[]>()
  if (!suscripcionIds.length) return out

  const { data: lins } = await db.from('documento_lineas')
    .select('documento_id, suscripcion_id').eq('documento_tipo', 'FACTURA')
    .in('suscripcion_id', suscripcionIds)
  const lineas = (lins ?? []) as { documento_id: string; suscripcion_id: string }[]
  if (!lineas.length) return out

  const facturaIds = [...new Set(lineas.map(l => l.documento_id))]
  const { data: facs } = await db.from('facturas')
    .select('factura_id, numero, estado, moneda, total, fecha_emision')
    .eq('client_id', clientId)
    .neq('estado', 'ANULADA')
    .in('factura_id', facturaIds)
  const facturas = (facs ?? []) as {
    factura_id: string; numero: string; estado: string
    moneda: string; total: number | string; fecha_emision: string
  }[]
  if (!facturas.length) return out

  const { data: movs } = await db.from('movimientos_tesoreria')
    .select('referencia_id, monto, monto_ref')
    .eq('client_id', clientId).eq('origen', 'COBRO')
    .in('referencia_id', facturas.map(f => f.factura_id))
  const cobrado = new Map<string, number>()
  for (const m of (movs ?? []) as { referencia_id: string; monto: number; monto_ref: number | null }[]) {
    cobrado.set(m.referencia_id, (cobrado.get(m.referencia_id) ?? 0) + Number(m.monto_ref ?? m.monto))
  }

  // Cuántos ACUERDOS distintos cubre cada factura: una factura agrupa por cliente+moneda,
  // así que puede cubrir varios del mismo cliente.
  const acuerdosDe = new Map<string, Set<string>>()
  for (const l of lineas) {
    if (!acuerdosDe.has(l.documento_id)) acuerdosDe.set(l.documento_id, new Set())
    acuerdosDe.get(l.documento_id)!.add(l.suscripcion_id)
  }

  const hoy = hoyStr()
  const ficha = new Map<string, FacturaDeAcuerdo>()
  for (const f of facturas) {
    ficha.set(f.factura_id, {
      factura_id:    f.factura_id,
      numero:        f.numero,
      fecha_emision: f.fecha_emision,
      moneda:        f.moneda,
      total:         Number(f.total) || 0,
      estado:        f.estado,
      saldo:         f.estado === 'BORRADOR'
        ? 0
        : estadoCobro(Number(f.total) || 0, cobrado.get(f.factura_id) ?? 0, null, hoy).saldo,
      acuerdos:      acuerdosDe.get(f.factura_id)?.size ?? 1,
    })
  }

  for (const l of lineas) {
    const f = ficha.get(l.documento_id)
    if (!f) continue                        // anulada o de otro tenant
    const arr = out.get(l.suscripcion_id) ?? []
    if (!arr.some(x => x.factura_id === f.factura_id)) arr.push(f)
    out.set(l.suscripcion_id, arr)
  }
  for (const arr of out.values()) arr.sort((a, b) => b.fecha_emision.localeCompare(a.fecha_emision))
  return out
}
