'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { ESTADOS_FACTURA_INGRESO } from '@/lib/contabilidad'
import {
  cobroEsIngreso, cobroNaceLiquidado, fuenteDeCobro, computaEnResultados, generaSaldo,
} from '@/lib/gastos-core'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { tieneModulo }       from '@/lib/modulos'
import { enviarEmail }       from '@/lib/email/enviar'
import { envolverEmail }     from '@/lib/email/layout'
import {
  construirResultadosPorMoneda, esRolPL,
  type ApunteGasto, type ApunteIngreso, type CategoriaPL, type ResultadoPL,
} from '@/lib/pl/estado'
import { periodoComparacion, type ModoComparacion } from '@/lib/pl/periodo'
import { construirXlsxReportes } from '@/lib/exportar/reportes-xlsx'
import { TZ_NEGOCIO } from '@/lib/fecha-tz'

// ── Tipos ─────────────────────────────────────────────────────────────────────

/**
 * El estado de resultados de una moneda: el waterfall estructurado que calcula
 * `@/lib/pl/estado` (puro y compartido), más las dos cifras INFORMATIVAS de
 * margen unitario que solo existen aquí.
 */
export interface ResultadoMoneda extends ResultadoPL {
  // ── Coste directo y margen unitario: INFORMATIVOS, fuera del neto ──
  // No confundir con `coste_ventas` del waterfall: aquél sale de gastos
  // incurridos y SÍ resta; éste sale de la foto congelada del coste en la línea
  // vendida y responde otra pregunta («¿qué artículo me deja dinero?»).
  costo_directo:       number   // Σ del coste congelado en las líneas vendidas
  costo_sin_proveedor: number   // parte del anterior que NO vuelve a contabilizar
  margen_unitario:     number   // ventas − costo_directo
}

/**
 * El MISMO estado de resultados del período desplazado, entero.
 *
 * Se devuelve completo —no tres totales— porque la comparación útil es por
 * RENGLÓN: «los ingresos suben un 56% pero el coste de ventas sube un 70%» es la
 * frase que explica por qué el margen cae, y con solo los totales no se puede
 * decir. La vista los empareja por moneda, por rol y por `categoria_id`.
 */
export type ResultadoAnterior = ResultadoPL

/**
 * Puente devengado ↔ caja: «ganaste X, cobraste Y, te deben Z».
 * Es la conciliación que falta cuando el dueño ve un buen resultado y la caja
 * vacía. `cobrado`/`pagado` son efectivo REAL del período (mismos movimientos
 * que el flujo de caja, con las cuentas de apertura ya excluidas); los pendientes
 * son el saldo VIVO de lo devengado en el período, se cobre cuando se cobre.
 */
export interface PuenteMoneda {
  moneda:          string
  resultado:       number   // neto devengado del período
  flujo:           number   // neto de caja del período
  cobrado:         number
  pagado:          number
  pendiente_cobro: number
  pendiente_pago:  number
}

export interface FlujoMoneda {
  moneda:           string
  entradas:         number   // movimientos INGRESO (origen MANUAL/COBRO)
  salidas:          number   // movimientos EGRESO (origen MANUAL/PAGO)
  neto:             number
  detalle_entradas: { origen: string; monto: number }[]
  detalle_salidas:  { origen: string; monto: number }[]
}

/**
 * Metadatos de "Ver en [moneda]": qué monedas se convirtieron a la vista y
 * cuáles se quedaron fuera por no tener tasa. Es la nota honesta que acompaña a
 * un informe convertido. `null` cuando no hubo conversión (vista nativa o todo
 * ya en la moneda vista).
 */
export interface ConversionVer {
  convertidas: string[]   // monedas que se convirtieron a la moneda vista
  excluidas:   string[]   // monedas sin tasa hacia la vista, no incluidas
}

/**
 * Consolidado de REFERENCIA: todas las monedas convertidas a la de consolidación
 * (`monedas.es_consolidacion`) a la tasa vigente. Es INDEPENDIENTE de la moneda
 * de la vista (`ver`) — siempre en la moneda de configuración — y se muestra como
 * un banner informativo al pie. `null` si no hay moneda de consolidación o si
 * sería redundante (una sola moneda y ya es la de consolidación).
 */
export interface ConsolidadoResumen {
  moneda:           string
  resultado:        { total_ingresos: number; total_gastos: number; neto: number } | null
  flujo:            { entradas: number; salidas: number; neto: number } | null
  monedasExcluidas: string[]   // monedas sin tasa hacia la de consolidación
}

export interface ReportesData {
  desde:       string
  hasta:       string
  empresa_id:  string
  empresas:    { empresa_id: string; nombre: string }[]
  resultado:   ResultadoMoneda[]
  flujo:       FlujoMoneda[]
  // ── "Ver en [moneda]" ──
  // `ver` = '' → vista NATIVA (una card por moneda con datos reales, sin
  // convertir). `ver` = código → informe único convertido a esa moneda: lo que
  // ya está en ella va nativo, el resto se convierte a la tasa vigente y se marca
  // (`convertido`). La bandera `es_consolidacion` solo fija el valor por defecto.
  ver:         string
  /** Monedas ofrecibles en el selector (las del cliente ∪ las presentes). */
  verOpciones: string[]
  /** Moneda por defecto la primera vez (la marcada `es_consolidacion`); '' si no hay. */
  verDefault:  string
  /** Monedas con datos reales en el período (para el selector, aun en vista convertida). */
  monedasPresentes: string[]
  /** Detalle de la conversión cuando `ver` está activo y hubo que convertir. */
  convertido:  ConversionVer | null
  /**
   * Referencia en la moneda de consolidación, SIEMPRE calculada sobre los datos
   * nativos e independiente de `ver`. Banner informativo al pie del informe.
   */
  consolidado: ConsolidadoResumen | null
  // ── Contexto (F1/F3): comparación temporal y puente con la caja ──
  comparar:    ModoComparacion
  /** Rango del período con el que se compara; null si no se compara. */
  periodo_comparado: { desde: string; hasta: string } | null
  /** El estado de resultados ENTERO del período desplazado, por moneda. */
  anterior:    ResultadoAnterior[]
  puente:      PuenteMoneda[]
  /** Con `inventario` el coste de ventas es real; sin él, coste de compras. */
  hay_inventario: boolean
}

// ── Obtener reportes del período ────────────────────────────────────────────────
// Estado de resultados: devengado (por fecha de documento).
// Flujo de caja: efectivo real (por fecha de movimiento de tesorería), excluye
// transferencias internas. Ambos separados por moneda (sin conversión).

export async function obtenerReportes(
  desde: string,
  hasta: string,
  empresaId: string,
  comparar: ModoComparacion = 'no',
  // `undefined` → usar el valor por defecto (la moneda `es_consolidacion`).
  // '' o 'nativo' → vista nativa. Un código → ver en esa moneda.
  ver?: string,
): Promise<ReportesData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const ids         = empresaId ? [empresaId] : (empresa_ids.length ? empresa_ids : ['__none__'])

  // El período de comparación se lee en la MISMA consulta, ampliando el rango y
  // partiendo en memoria: dos viajes a Supabase por informe se notan en 3G.
  const comp = periodoComparacion(desde, hasta, comparar)
  const desdeQ = comp && comp.desde < desde ? comp.desde : desde
  const hastaQ = comp && comp.hasta > hasta ? comp.hasta : hasta

  const [facRes, gcRes, movRes, monRes, tasasRes, aperRes, catRes, cliRes] = await Promise.all([
    db.from('facturas').select('factura_id, moneda, total, fecha_emision, estado')
      .eq('client_id', session.client_id).in('empresa_id', ids)
      .in('estado', ESTADOS_FACTURA_INGRESO)
      .gte('fecha_emision', desdeQ).lte('fecha_emision', hastaQ),
    db.from('gastos_cobros').select('registro_id, tipo, moneda, monto, categoria, categoria_id, fecha, origen_tipo, naturaleza')
      .eq('client_id', session.client_id).in('empresa_id', ids)
      .gte('fecha', desdeQ).lte('fecha', hastaQ),
    db.from('movimientos_tesoreria').select('tipo, moneda, monto, origen, fecha, cuenta_id')
      .eq('client_id', session.client_id).in('empresa_id', ids)
      .neq('origen', 'TRANSFERENCIA')
      .gte('fecha', desde).lte('fecha', hasta),
    db.from('monedas').select('codigo, es_consolidacion').eq('client_id', session.client_id),
    db.from('tasas_cambio').select('moneda_origen, moneda_destino, tasa, fecha')
      .eq('client_id', session.client_id).order('fecha', { ascending: false }),
    db.from('cuentas').select('cuenta_id')
      .eq('client_id', session.client_id).eq('es_apertura', true),
    // El catálogo de categorías es lo que da ESTRUCTURA al informe: sin él los
    // gastos vuelven a ser una lista plana (ver `@/lib/pl/estado`).
    db.from('categorias_gastos').select('categoria_id, nombre, parent_id, rol_pl')
      .eq('client_id', session.client_id),
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).maybeSingle(),
  ])

  const hay_inventario = tieneModulo(cliRes.data?.modulos_activos, 'inventario')

  const categorias: CategoriaPL[] = ((catRes.data ?? []) as {
    categoria_id: string; nombre: string; parent_id: string | null; rol_pl: string | null
  }[]).map(c => ({
    categoria_id: c.categoria_id,
    nombre:       c.nombre,
    parent_id:    c.parent_id,
    rol_pl:       esRolPL(c.rol_pl) ? c.rol_pl : 'OPERATIVO',
  }))

  type FilaFactura = { factura_id: string; moneda: string; total: number; fecha_emision: string }
  type FilaGC = { registro_id: string; tipo: string; moneda: string; monto: number; categoria: string | null; categoria_id: string | null; fecha: string; origen_tipo: string | null; naturaleza: string | null }

  const facturas = (facRes.data ?? []) as FilaFactura[]
  const gastosCobros = (gcRes.data ?? []) as FilaGC[]

  const enRango = (f: string, d: string, h: string) => !!f && f >= d && f <= h

  // ── Apuntes normalizados de un rango (lo que come el motor) ──
  function apuntesDe(d: string, h: string): { ingresos: ApunteIngreso[]; gastos: ApunteGasto[] } {
    const ingresos: ApunteIngreso[] = []
    const gastos:   ApunteGasto[]   = []
    for (const f of facturas) {
      if (!enRango(f.fecha_emision, d, h)) continue
      ingresos.push({ moneda: f.moneda, monto: Number(f.total), mes: f.fecha_emision.slice(0, 7), fuente: 'VENTA' })
    }
    for (const g of gastosCobros) {
      if (!enRango(g.fecha, d, h)) continue
      if (g.tipo === 'COBRO') {
        // Dos preguntas distintas sobre la misma fila, y conviene no mezclarlas:
        //  · `cobroEsIngreso` decide SI SUMA. Una fila que es solo DEUDA (mig. 166) no
        //    es ingreso —el subsidio recupera un anticipo—; sin este filtro infla
        //    ingresos y resultado neto.
        //  · `fuenteDeCobro` decide EN QUÉ RENGLÓN. El cierre del punto de venta es una
        //    venta de mostrador, así que va a «Ventas» junto a las facturas: sin esto el
        //    importe cae en «cobros directos» y un negocio que solo vende por TPV ve su
        //    renglón de Ventas en blanco.
        if (!cobroEsIngreso(g.naturaleza)) continue
        ingresos.push({
          moneda: g.moneda, monto: Number(g.monto), mes: g.fecha.slice(0, 7),
          fuente: fuenteDeCobro(g.origen_tipo),
        })
      } else {
        // Un GASTO que es solo DEUDA no es coste: el salario neto y las retenciones de
        // una nómina ya están contados en las filas de COSTE de esa misma nómina, y
        // sumarlos otra vez duplicaría el renglón de Personal.
        if (!computaEnResultados(g.naturaleza)) continue
        gastos.push({
          moneda: g.moneda, monto: Number(g.monto), mes: g.fecha.slice(0, 7),
          categoria_id: g.categoria_id, categoria: g.categoria,
        })
      }
    }
    return { ingresos, gastos }
  }

  const act = apuntesDe(desde, hasta)
  const base = construirResultadosPorMoneda(act.ingresos, act.gastos, categorias, { hayInventario: hay_inventario })

  // ── Coste directo y margen UNITARIO (informativos) ──
  // No se restan del neto a propósito, y por eso no son el `coste_ventas` del
  // waterfall: el coste de un servicio CON proveedor ya está dentro de
  // `total_gastos` como la CxP automática (mig. 118), y el de un servicio que
  // presta la plantilla ya está en el gasto «Salarios» de la nómina confirmada.
  // Restarlo otra vez contaría lo mismo dos veces. Sale de la FOTO congelada en
  // la línea, no del catálogo: el margen de enero no lo reescribe una subida de
  // tarifa en marzo.
  const monedaPorFactura = new Map<string, string>()
  for (const f of facturas) {
    if (enRango(f.fecha_emision, desde, hasta)) monedaPorFactura.set(f.factura_id, f.moneda)
  }
  const costoPorMoneda    = new Map<string, number>()
  const costoSinProveedor = new Map<string, number>()

  if (monedaPorFactura.size) {
    const { data: lins } = await db.from('documento_lineas')
      .select('documento_id, producto_id, cantidad, costo_unitario')
      .eq('documento_tipo', 'FACTURA')
      .in('documento_id', [...monedaPorFactura.keys()])
      .not('costo_unitario', 'is', null)

    type LinCosto = { documento_id: string; producto_id: string | null; cantidad: number; costo_unitario: number }
    const lineas = (lins ?? []) as LinCosto[]
    const prodIds = [...new Set(lineas.map(l => l.producto_id).filter((id): id is string => !!id))]

    const conProveedor = new Set<string>()
    if (prodIds.length) {
      const { data: prods } = await db.from('products')
        .select('producto_id, proveedor_id')
        .eq('client_id', session.client_id).in('producto_id', prodIds)
        .not('proveedor_id', 'is', null)
      for (const p of (prods ?? []) as { producto_id: string }[]) conProveedor.add(p.producto_id)
    }

    for (const l of lineas) {
      const moneda = monedaPorFactura.get(l.documento_id)
      if (!moneda) continue
      const coste = Number(l.cantidad) * Number(l.costo_unitario)
      costoPorMoneda.set(moneda, (costoPorMoneda.get(moneda) ?? 0) + coste)
      if (!l.producto_id || !conProveedor.has(l.producto_id)) {
        costoSinProveedor.set(moneda, (costoSinProveedor.get(moneda) ?? 0) + coste)
      }
    }
  }

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

  const resMap = new Map<string, ResultadoMoneda>()
  for (const r of base) {
    const costo_directo = round2(costoPorMoneda.get(r.moneda) ?? 0)
    resMap.set(r.moneda, {
      ...r,
      costo_directo,
      costo_sin_proveedor: round2(costoSinProveedor.get(r.moneda) ?? 0),
      margen_unitario:     round2(r.ventas - costo_directo),
    })
  }

  // ── El período desplazado, calculado con el MISMO motor ──
  // Entero, no resumido: la comparación por renglón es la que explica el margen.
  const antApuntes = comp ? apuntesDe(comp.desde, comp.hasta) : null
  const anterior: ResultadoAnterior[] = antApuntes
    ? construirResultadosPorMoneda(antApuntes.ingresos, antApuntes.gastos, categorias, { hayInventario: hay_inventario })
    : []

  // ── Flujo de caja (efectivo) ──
  const flujoMap = new Map<string, FlujoMoneda>()
  const entradasMap = new Map<string, Map<string, number>>()  // moneda → origen → monto
  const salidasMap  = new Map<string, Map<string, number>>()
  const getFlujo = (moneda: string) => {
    let f = flujoMap.get(moneda)
    if (!f) { f = { moneda, entradas: 0, salidas: 0, neto: 0, detalle_entradas: [], detalle_salidas: [] }; flujoMap.set(moneda, f) }
    return f
  }

  // Las cuentas de «Apertura» (mig. 130) quedan FUERA del flujo: son el contrapeso
  // técnico con el que la migración salda el histórico ya pagado, no efectivo que
  // haya entrado o salido de verdad. En el estado de resultados, en cambio, esos
  // gastos SÍ cuentan (están en `gastos_cobros`, por su fecha) — que es justo lo
  // que se busca: resultado devengado completo, caja intacta.
  const cuentasApertura = new Set(((aperRes.data ?? []) as { cuenta_id: string }[]).map(c => c.cuenta_id))

  for (const m of (movRes.data ?? []) as { tipo: string; moneda: string; monto: number; origen: string; cuenta_id: string }[]) {
    if (cuentasApertura.has(m.cuenta_id)) continue
    const f = getFlujo(m.moneda)
    const monto = Number(m.monto)
    if (m.tipo === 'INGRESO') {
      f.entradas += monto
      const e = entradasMap.get(m.moneda) ?? new Map<string, number>()
      e.set(m.origen, (e.get(m.origen) ?? 0) + monto); entradasMap.set(m.moneda, e)
    } else {
      f.salidas += monto
      const s = salidasMap.get(m.moneda) ?? new Map<string, number>()
      s.set(m.origen, (s.get(m.origen) ?? 0) + monto); salidasMap.set(m.moneda, s)
    }
  }
  for (const [moneda, e] of entradasMap) {
    getFlujo(moneda).detalle_entradas = Array.from(e.entries()).map(([origen, monto]) => ({ origen, monto })).sort((a, b) => b.monto - a.monto)
  }
  for (const [moneda, s] of salidasMap) {
    getFlujo(moneda).detalle_salidas = Array.from(s.entries()).map(([origen, monto]) => ({ origen, monto })).sort((a, b) => b.monto - a.monto)
  }
  for (const f of flujoMap.values()) f.neto = f.entradas - f.salidas

  const ordenar = <T extends { moneda: string }>(arr: T[]) => arr.sort((a, b) => a.moneda.localeCompare(b.moneda))
  const resultado = ordenar(Array.from(resMap.values()))
  const flujo     = ordenar(Array.from(flujoMap.values()))

  // ── Tasas de cambio: factor GENÉRICO entre dos monedas ──────────────────────
  // Se ancla en los pares que haya (1 origen = X destino). Directo, inverso, y si
  // no, triangulación por la moneda de consolidación (el pivote habitual: casi
  // todas las tasas se definen contra ella). Sin camino → `null` y la moneda se
  // excluye de la conversión y se informa.
  const consolCode: string | null =
    (monRes.data ?? []).find((m: { codigo: string; es_consolidacion: boolean }) => m.es_consolidacion)?.codigo ?? null
  const rateMap = new Map<string, number>()
  for (const t of (tasasRes.data ?? [])) {
    const k = `${t.moneda_origen}__${t.moneda_destino}`
    if (!rateMap.has(k)) rateMap.set(k, Number(t.tasa))  // primera = más reciente
  }
  const rate = (a: string, b: string): number | null => {
    const r = rateMap.get(`${a}__${b}`)
    return r && r > 0 ? r : null
  }
  // Factor tal que `monto_destino = monto_origen * factor`.
  const factorPar = (from: string, to: string): number | null => {
    if (from === to) return 1
    const d = rate(from, to); if (d != null) return d       // 1 from = d to
    const i = rate(to, from); if (i != null) return 1 / i   // 1 to = i from
    return null
  }
  const factorEntre = (from: string, to: string): number | null => {
    const dir = factorPar(from, to)
    if (dir != null) return dir
    if (consolCode && from !== consolCode && to !== consolCode) {
      const f1 = factorPar(from, consolCode), f2 = factorPar(consolCode, to)
      if (f1 != null && f2 != null) return f1 * f2
    }
    return null
  }

  // ── Puente devengado ↔ caja ────────────────────────────────────────────────
  // «Ganaste X, cobraste Y, te deben Z». Es la conciliación que faltaba: sin ella
  // un buen resultado con la caja vacía parece un error del sistema, cuando lo
  // que pasa es que está todo por cobrar.
  //
  // El pendiente es el saldo VIVO de lo devengado EN EL PERÍODO —se cobre cuando
  // se cobre—, así que las liquidaciones se leen sin filtro de fecha: una factura
  // de julio pagada en agosto ya no se debe, y decir que sí sería mentir.
  const puente: PuenteMoneda[] = []
  {
    const facturasPer = facturas.filter(f => enRango(f.fecha_emision, desde, hasta))
    // Mismo criterio que `apuntesDe`: el anticipo no es ingreso devengado, así que
    // no entra en el puente. Si entrara, el puente enseñaría un ingreso que el
    // estado de resultados no tiene.
    const cobrosPer   = gastosCobros.filter(g => g.tipo === 'COBRO' && cobroEsIngreso(g.naturaleza) && enRango(g.fecha, desde, hasta))
    // Los dos lados usan predicados DISTINTOS a propósito, porque responden a
    // preguntas distintas (mig. 166). Lo pendiente de PAGO es deuda: `generaSaldo`. Si
    // aquí se filtrara por «computa en resultados», las filas de COSTE de una nómina
    // —que no las liquida nadie, la deuda va en sus propias filas— se quedarían
    // eternamente pendientes por su importe completo, y el puente enseñaría una deuda
    // fantasma que no se puede pagar desde ninguna pantalla.
    const gastosPer   = gastosCobros.filter(g => g.tipo === 'GASTO' && generaSaldo(g.naturaleza) && enRango(g.fecha, desde, hasta))
    const refs = [
      ...facturasPer.map(f => f.factura_id),
      ...cobrosPer.map(g => g.registro_id),
      ...gastosPer.map(g => g.registro_id),
    ]

    const liquidado = new Map<string, number>()
    if (refs.length) {
      const { data: liqs } = await db.from('movimientos_tesoreria')
        .select('referencia_id, monto, monto_ref')
        .eq('client_id', session.client_id)
        .in('origen', ['PAGO', 'COBRO'])
        .in('referencia_id', refs)
      for (const m of (liqs ?? []) as { referencia_id: string; monto: number; monto_ref: number | null }[]) {
        // `monto_ref` es el importe en la moneda del documento (el que reduce su
        // saldo); `monto` es lo que salió de la caja, que puede ser otra moneda.
        liquidado.set(m.referencia_id, (liquidado.get(m.referencia_id) ?? 0) + Number(m.monto_ref ?? m.monto))
      }
    }
    const saldo = (id: string, total: number) => Math.max(0, Number(total) - (liquidado.get(id) ?? 0))

    const pendCobro = new Map<string, number>()
    const pendPago  = new Map<string, number>()
    for (const f of facturasPer) pendCobro.set(f.moneda, (pendCobro.get(f.moneda) ?? 0) + saldo(f.factura_id, f.total))
    for (const g of cobrosPer) {
      // El resumen del cierre de caja SÍ es devengado del período (arriba, en `apuntesDe`,
      // suma como Ventas) pero NO está pendiente: su dinero entró en la caja por el
      // movimiento `origen='CAJA'`, que no lleva `referencia_id` a este registro. Sin
      // esta excepción `saldo()` devuelve el importe completo y el puente enseña como
      // «te deben» exactamente el dinero que el propio puente ya cuenta como cobrado.
      if (cobroNaceLiquidado(g.origen_tipo)) continue
      pendCobro.set(g.moneda, (pendCobro.get(g.moneda) ?? 0) + saldo(g.registro_id, g.monto))
    }
    for (const g of gastosPer)   pendPago.set(g.moneda,  (pendPago.get(g.moneda)  ?? 0) + saldo(g.registro_id, g.monto))

    // Solo monedas CON devengado. Una moneda en la que solo hubo movimientos de
    // caja (p. ej. un pago suelto en EUR sin factura ni gasto) daba un puente de
    // «Resultado devengado 0,00» contra un flujo negativo: aritméticamente cierto
    // y completamente inútil — el puente existe para explicar la distancia entre
    // dos cifras, y ahí una de las dos no existe. Su flujo ya está más abajo.
    for (const moneda of [...resMap.keys()].sort((a, b) => a.localeCompare(b))) {
      const r = resMap.get(moneda)
      const f = flujoMap.get(moneda)
      const fila: PuenteMoneda = {
        moneda,
        resultado:       round2(r?.neto ?? 0),
        flujo:           round2(f?.neto ?? 0),
        cobrado:         round2(f?.entradas ?? 0),
        pagado:          round2(f?.salidas ?? 0),
        pendiente_cobro: round2(pendCobro.get(moneda) ?? 0),
        pendiente_pago:  round2(pendPago.get(moneda) ?? 0),
      }
      // Regla del P&L progresivo: si devengado y caja dicen lo mismo y no hay
      // nada pendiente, el puente no aporta nada y NO se pinta.
      const hayDesfase = Math.abs(fila.resultado - fila.flujo) > 0.005
        || fila.pendiente_cobro > 0.005 || fila.pendiente_pago > 0.005
      if (hayDesfase) puente.push(fila)
    }
  }

  // ── Consolidado de referencia (banner informativo) ──────────────────────────
  // SIEMPRE en la moneda de configuración (`es_consolidacion`) y SIEMPRE sobre los
  // datos NATIVOS: es la referencia estable «cuánto es esto en total», mires el
  // informe en la moneda que lo mires. Truncado a 2 decimales (no redondeado).
  const trunc2 = (n: number) => (n < 0 ? -1 : 1) * Math.floor(Math.abs(n) * 100 + 1e-6) / 100
  let consolidado: ConsolidadoResumen | null = null
  if (consolCode) {
    const presentes = new Set<string>([...resultado.map(r => r.moneda), ...flujo.map(f => f.moneda)])
    // Con una sola moneda y siendo ya la de consolidación, el banner repetiría el informe.
    const redundante = presentes.size === 1 && presentes.has(consolCode)
    if (presentes.size > 0 && !redundante) {
      const excluidas = new Set<string>()
      let ri = 0, rg = 0, hayRes = false
      for (const r of resultado) {
        const f = factorEntre(r.moneda, consolCode)
        if (f == null) { excluidas.add(r.moneda); continue }
        ri += r.total_ingresos * f; rg += r.total_gastos * f; hayRes = true
      }
      let fe = 0, fs = 0, hayFlujo = false
      for (const fl of flujo) {
        const f = factorEntre(fl.moneda, consolCode)
        if (f == null) { excluidas.add(fl.moneda); continue }
        fe += fl.entradas * f; fs += fl.salidas * f; hayFlujo = true
      }
      const resC   = hayRes   ? { total_ingresos: trunc2(ri), total_gastos: trunc2(rg), neto: trunc2(ri - rg) } : null
      const flujoC = hayFlujo ? { entradas: trunc2(fe), salidas: trunc2(fs), neto: trunc2(fe - fs) } : null
      if (resC || flujoC) {
        consolidado = { moneda: consolCode, resultado: resC, flujo: flujoC, monedasExcluidas: [...excluidas].sort() }
      }
    }
  }

  // ── "Ver en [moneda]" ───────────────────────────────────────────────────────
  // Vista NATIVA por defecto (ver = ''): una card por moneda, sin convertir. Al
  // elegir una moneda X, se colapsa TODO a X: lo ya nativo va tal cual y el resto
  // se convierte a la tasa vigente (marcado en `convertido`). La conversión del
  // estado de resultados se hace RELABELIZANDO los apuntes a X y volviendo a pasar
  // el MISMO motor —así el waterfall, la comparación y la evolución mensual se
  // fusionan solos—; el flujo y el puente, ya calculados, se suman convertidos.
  const monedasPresentes = [...new Set([...resultado.map(r => r.moneda), ...flujo.map(f => f.moneda)])].sort()
  const monedasCliente   = (monRes.data ?? []).map((m: { codigo: string }) => m.codigo)
  const verOpciones      = [...new Set([...monedasCliente, ...monedasPresentes])].sort()
  const verDefault       = consolCode ?? ''

  // Resolución del `ver` aplicado. Por defecto NATIVA (cada moneda con sus datos
  // reales, sin convertir): es la verdad contable y lo que el dueño reconoce de un
  // vistazo. Convertir es opt-in. `es_consolidacion` (verDefault) solo se ofrece
  // como sugerencia en el selector, no se fuerza al entrar.
  let verAplicado = ver === undefined || ver === 'nativo' ? '' : ver
  // Cookie/URL con una moneda que ya no existe → nativo, no un informe vacío.
  if (verAplicado && !verOpciones.includes(verAplicado)) verAplicado = ''
  if (verOpciones.length < 2) verAplicado = ''

  let resultadoFinal = resultado
  let flujoFinal     = flujo
  let anteriorFinal  = anterior
  let puenteFinal    = puente
  let convertido: ConversionVer | null = null

  if (verAplicado) {
    const X = verAplicado
    const convd = new Set<string>()
    const excl  = new Set<string>()
    // Convierte apuntes {moneda, monto} a X (o los descarta si no hay tasa).
    // `track` alimenta la nota "convertido/excluidas" SOLO con lo que se ve como
    // cifra principal: el período comparado (anterior) convierte igual, pero sus
    // monedas no deben aparecer en la nota o menciona monedas que no están en pantalla.
    const conv = <T extends { moneda: string; monto: number }>(arr: T[], track = true): T[] => {
      const out: T[] = []
      for (const a of arr) {
        if (a.moneda === X) { out.push(a); continue }
        const f = factorEntre(a.moneda, X)
        if (f == null) { if (track) excl.add(a.moneda); continue }
        if (track) convd.add(a.moneda)
        out.push({ ...a, moneda: X, monto: a.monto * f })
      }
      return out
    }

    // Estado de resultados (actual y comparación) por el mismo motor.
    const baseVer = construirResultadosPorMoneda(conv(act.ingresos), conv(act.gastos), categorias, { hayInventario: hay_inventario })
    const antVer  = antApuntes
      ? construirResultadosPorMoneda(conv(antApuntes.ingresos, false), conv(antApuntes.gastos, false), categorias, { hayInventario: hay_inventario })
      : []

    // Coste directo / margen unitario: convertidos y sumados.
    let costoV = 0, costoSinV = 0
    for (const [m, v] of costoPorMoneda)    { const f = factorEntre(m, X); if (f != null) costoV    += v * f }
    for (const [m, v] of costoSinProveedor) { const f = factorEntre(m, X); if (f != null) costoSinV += v * f }
    const rV = baseVer[0]
    resultadoFinal = rV
      ? [{ ...rV, costo_directo: round2(costoV), costo_sin_proveedor: round2(costoSinV), margen_unitario: round2(rV.ventas - costoV) }]
      : []
    anteriorFinal = antVer.slice(0, 1)

    // Flujo: fusiona las monedas convertidas en una sola (X), con su detalle por origen.
    {
      const detE = new Map<string, number>(), detS = new Map<string, number>()
      let entradas = 0, salidas = 0, hay = false
      for (const f of flujo) {
        const k = f.moneda === X ? 1 : factorEntre(f.moneda, X)
        if (k == null) { excl.add(f.moneda); continue }
        if (f.moneda !== X) convd.add(f.moneda)
        hay = true
        entradas += f.entradas * k; salidas += f.salidas * k
        for (const e of f.detalle_entradas) detE.set(e.origen, (detE.get(e.origen) ?? 0) + e.monto * k)
        for (const s of f.detalle_salidas)  detS.set(s.origen, (detS.get(s.origen) ?? 0) + s.monto * k)
      }
      flujoFinal = hay ? [{
        moneda: X, entradas: round2(entradas), salidas: round2(salidas), neto: round2(entradas - salidas),
        detalle_entradas: [...detE].map(([origen, monto]) => ({ origen, monto: round2(monto) })).sort((a, b) => b.monto - a.monto),
        detalle_salidas:  [...detS].map(([origen, monto]) => ({ origen, monto: round2(monto) })).sort((a, b) => b.monto - a.monto),
      }] : []
    }

    // Puente: suma las filas convertidas en una sola (X).
    {
      const acc = { resultado: 0, flujo: 0, cobrado: 0, pagado: 0, pendiente_cobro: 0, pendiente_pago: 0 }
      let hay = false
      for (const p of puente) {
        const k = p.moneda === X ? 1 : factorEntre(p.moneda, X)
        if (k == null) { excl.add(p.moneda); continue }
        if (p.moneda !== X) convd.add(p.moneda)
        hay = true
        acc.resultado += p.resultado * k; acc.flujo += p.flujo * k
        acc.cobrado += p.cobrado * k; acc.pagado += p.pagado * k
        acc.pendiente_cobro += p.pendiente_cobro * k; acc.pendiente_pago += p.pendiente_pago * k
      }
      puenteFinal = hay ? [{
        moneda: X,
        resultado: round2(acc.resultado), flujo: round2(acc.flujo),
        cobrado: round2(acc.cobrado), pagado: round2(acc.pagado),
        pendiente_cobro: round2(acc.pendiente_cobro), pendiente_pago: round2(acc.pendiente_pago),
      }] : []
    }

    convertido = (convd.size || excl.size)
      ? { convertidas: [...convd].sort(), excluidas: [...excl].sort() }
      : null
  }

  return {
    desde,
    hasta,
    empresa_id: empresaId,
    empresas:   empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    resultado:  resultadoFinal,
    flujo:      flujoFinal,
    ver:        verAplicado,
    verOpciones,
    verDefault,
    monedasPresentes,
    convertido,
    consolidado,
    comparar,
    periodo_comparado: comp,
    anterior:   anteriorFinal,
    puente:     puenteFinal,
    hay_inventario,
  }
}

// ── Envío de reportes al asesor ─────────────────────────────────────────────────
// El PDF llega YA generado desde el cliente (mismo que se descarga → paridad visual
// y "el usuario sabe lo que envía"). El EXCEL se genera aquí en servidor a partir
// de los MISMOS datos re-obtenidos con obtenerReportes (fuente autoritativa): el
// escritor de .xlsx es server-only y, además, los datos del correo no deben venir
// del cliente.

function fmtMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export interface EnviarReportesAsesorInput {
  asesor_id:          string
  desde:              string
  hasta:              string
  empresa_id:         string   // '' = todas
  incluirConsolidado: boolean
  incluirPDF:         boolean
  incluirXLSX:        boolean
  comparar?:          ModoComparacion   // el CSV lleva el mismo contexto que la pantalla
  ver?:               string            // moneda de la vista (WYSIWYG); '' = por moneda
  nota?:              string
  pdfBase64?:         string   // sin prefijo data:; obligatorio si incluirPDF
  pdfNombre?:         string
  xlsxNombre?:        string
}

/**
 * El mismo Excel, para descargarlo desde la vista.
 *
 * Va por server action y no por ruta: el escritor de .xlsx es server-only (no
 * debe entrar en el bundle del portal) y así la descarga sigue siendo directa —
 * base64 → Blob → clic, sin abrir una página ni recargar, que es la regla de
 * descargas del proyecto (conexión de Cuba).
 */
export async function generarXlsxReportes(
  desde: string, hasta: string, empresaId: string, comparar: ModoComparacion,
  ver?: string, incluirConsolidado = true,
): Promise<{ ok: boolean; error?: string; base64?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

  const db = createAdminClient()
  const { data: cliMod } = await db.from('clients').select('modulos_activos, nombre_empresa')
    .eq('client_id', session.client_id).maybeSingle()
  if (!tieneModulo(cliMod?.modulos_activos, 'base')) {
    return { ok: false, error: 'El módulo de Contabilidad no está activo.' }
  }

  const data = await obtenerReportes(desde, hasta, empresaId, comparar, ver)
  if (!data) return { ok: false, error: 'No se pudieron leer los reportes.' }

  const empresa = empresaId
    ? (data.empresas.find(e => e.empresa_id === empresaId)?.nombre ?? empresaId)
    : data.empresas.length === 1
      ? data.empresas[0].nombre
      : 'Todas las empresas'

  const base64 = await construirXlsxReportes(data, {
    negocio:  (cliMod?.nombre_empresa as string) || 'Mi negocio',
    empresa,
    generado: new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', timeZone: TZ_NEGOCIO }),
  }, incluirConsolidado)

  return { ok: true, base64 }
}

export async function enviarReportesAsesor(
  input: EnviarReportesAsesorInput,
): Promise<{ ok: boolean; error?: string; email?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  if (!input.incluirPDF && !input.incluirXLSX) {
    return { ok: false, error: 'Selecciona al menos un archivo (PDF o Excel).' }
  }
  if (input.incluirPDF && !input.pdfBase64) {
    return { ok: false, error: 'No se pudo adjuntar el PDF. Reintenta.' }
  }

  const db = createAdminClient()

  // Gate de módulo: los reportes y su envío viven en Contabilidad (`base`).
  const { data: cliMod } = await db.from('clients').select('modulos_activos').eq('client_id', session.client_id).maybeSingle()
  if (!tieneModulo(cliMod?.modulos_activos, 'base')) return { ok: false, error: 'El módulo de Contabilidad no está activo.' }

  // Asesor destinatario (validado contra el directorio del cliente).
  const { data: asesor } = await db.from('asesores')
    .select('nombre, email, empresa_id')
    .eq('asesor_id', input.asesor_id).eq('client_id', session.client_id).eq('activo', true)
    .maybeSingle()
  if (!asesor) return { ok: false, error: 'Asesor no encontrado.' }

  // Datos autoritativos: se re-obtienen en servidor, no se confía en el cliente.
  // Se envía EN LA MONEDA QUE VE el dueño (`ver`): lo que ve es lo que manda.
  const data = await obtenerReportes(input.desde, input.hasta, input.empresa_id, input.comparar ?? 'no', input.ver)
  if (!data) return { ok: false, error: 'No se pudieron leer los reportes.' }

  // Mismo criterio que la pantalla: con UNA sola empresa, «todas» es ella. Si
  // aquí dijera otra cosa, el correo al asesor y el CSV llevarían un alcance
  // distinto del que el dueño vio al pulsar «Enviar».
  const empresaLabel = input.empresa_id
    ? (data.empresas.find(e => e.empresa_id === input.empresa_id)?.nombre ?? input.empresa_id)
    : data.empresas.length === 1
      ? data.empresas[0].nombre
      : 'Todas las empresas'

  const { data: cli } = await db.from('clients')
    .select('nombre_empresa').eq('client_id', session.client_id).maybeSingle()
  const negocio = (cli?.nombre_empresa as string) || 'el negocio'

  // Adjuntos
  const attachments: { filename: string; content: string }[] = []
  if (input.incluirPDF && input.pdfBase64) {
    attachments.push({ filename: (input.pdfNombre || 'reportes.pdf').replace(/[^\w.-]+/g, '_'), content: input.pdfBase64 })
  }
  if (input.incluirXLSX) {
    const base64 = await construirXlsxReportes(data, {
      negocio:  negocio,
      empresa:  empresaLabel,
      generado: new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', timeZone: TZ_NEGOCIO }),
    }, input.incluirConsolidado)
    attachments.push({
      filename: (input.xlsxNombre || 'reportes.xlsx').replace(/[^\w.-]+/g, '_'),
      content:  base64,
    })
  }
  if (!attachments.length) return { ok: false, error: 'No hay nada que adjuntar.' }

  // Resumen "lo que se envía": neto por moneda (o el único neto de la vista convertida).
  const fechaTxt = `${input.desde} — ${input.hasta}`
  const lineasRes = data.resultado.map(r =>
    `<tr><td style="padding:2px 0;">Resultado neto (${r.moneda})</td><td style="padding:2px 0;text-align:right;font-weight:600;">${fmtMonto(r.neto)}</td></tr>`)
  const lineasFlu = data.flujo.map(f =>
    `<tr><td style="padding:2px 0;">Flujo neto (${f.moneda})</td><td style="padding:2px 0;text-align:right;font-weight:600;">${fmtMonto(f.neto)}</td></tr>`)
  const lineaConsol = (input.incluirConsolidado && data.consolidado?.resultado)
    ? `<tr><td style="padding:2px 0;">Resultado neto consolidado (${data.consolidado.moneda})</td><td style="padding:2px 0;text-align:right;font-weight:600;">${fmtMonto(data.consolidado.resultado.neto)}</td></tr>`
    : ''
  const resumenTabla = (lineasRes.length || lineasFlu.length)
    ? `<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;margin:12px 0;">${lineasRes.join('')}${lineasFlu.join('')}${lineaConsol}</table>`
    : '<p style="margin:12px 0;color:#5C5B52;">Sin movimientos en el período.</p>'

  const notaHtml = input.nota?.trim()
    ? `<p style="margin:0 0 16px;padding:12px 16px;background:#F5F4EF;border-radius:8px;">${input.nota.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`
    : ''

  const adjuntosTxt = attachments.map(a => a.filename).join(' · ')

  const cuerpo = `
    <p style="margin:0 0 16px;">Hola ${asesor.nombre.replace(/</g, '&lt;')},</p>
    <p style="margin:0 0 16px;">Te comparto los reportes financieros de <strong>${negocio.replace(/</g, '&lt;')}</strong>.</p>
    ${notaHtml}
    <p style="margin:0 0 4px;font-size:13px;color:#5C5B52;">Alcance: <strong>${empresaLabel.replace(/</g, '&lt;')}</strong> · Período: <strong>${fechaTxt}</strong></p>
    ${resumenTabla}
    <p style="margin:0 0 16px;font-size:13px;color:#5C5B52;">Adjuntos: ${adjuntosTxt}</p>
    <p style="margin:0;font-size:12px;color:#5C5B52;">Cifras operativas generadas por CLAUX a partir de la actividad del negocio; no constituyen un cierre contable oficial.</p>
  `

  const asunto = `Reportes financieros · ${empresaLabel} · ${fechaTxt}`

  const res = await enviarEmail({
    to:          asesor.email,
    subject:     asunto,
    html:        envolverEmail(cuerpo),
    tipo:        'reporte_asesor',
    clientId:    session.client_id,
    replyTo:     session.email,   // el asesor responde directo al dueño
    attachments,
    meta: {
      asesor_id: input.asesor_id, empresa: empresaLabel,
      desde: input.desde, hasta: input.hasta,
      archivos: attachments.map(a => a.filename),
    },
  })

  if (!res.ok) return { ok: false, error: 'No se pudo enviar el correo. Revisa la conexión e inténtalo de nuevo.' }
  return { ok: true, email: asesor.email }
}
