'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ResultadoMoneda {
  moneda:               string
  ventas:               number   // facturas emitidas/cobradas (devengado)
  cobros_directos:      number   // gastos_cobros tipo COBRO
  total_ingresos:       number
  gastos_por_categoria: { categoria: string; monto: number }[]
  total_gastos:         number
  neto:                 number
}

export interface FlujoMoneda {
  moneda:           string
  entradas:         number   // movimientos INGRESO (origen MANUAL/COBRO)
  salidas:          number   // movimientos EGRESO (origen MANUAL/PAGO)
  neto:             number
  detalle_entradas: { origen: string; monto: number }[]
  detalle_salidas:  { origen: string; monto: number }[]
}

// Consolidado: todas las monedas convertidas a la moneda de consolidación
// (monedas.es_consolidacion) con la tasa vigente, truncado a 2 decimales.
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
  consolidado: ConsolidadoResumen | null
}

// ── Obtener reportes del período ────────────────────────────────────────────────
// Estado de resultados: devengado (por fecha de documento).
// Flujo de caja: efectivo real (por fecha de movimiento de tesorería), excluye
// transferencias internas. Ambos separados por moneda (sin conversión).

export async function obtenerReportes(
  desde: string,
  hasta: string,
  empresaId: string,
): Promise<ReportesData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const ids         = empresaId ? [empresaId] : (empresa_ids.length ? empresa_ids : ['__none__'])

  const [facRes, gcRes, movRes, consolRes, tasasRes] = await Promise.all([
    db.from('facturas').select('moneda, total, fecha_emision, estado')
      .eq('client_id', session.client_id).in('empresa_id', ids)
      .in('estado', ['EMITIDA', 'COBRADA'])
      .gte('fecha_emision', desde).lte('fecha_emision', hasta),
    db.from('gastos_cobros').select('tipo, moneda, monto, categoria, fecha')
      .eq('client_id', session.client_id).in('empresa_id', ids)
      .gte('fecha', desde).lte('fecha', hasta),
    db.from('movimientos_tesoreria').select('tipo, moneda, monto, origen, fecha')
      .eq('client_id', session.client_id).in('empresa_id', ids)
      .neq('origen', 'TRANSFERENCIA')
      .gte('fecha', desde).lte('fecha', hasta),
    db.from('monedas').select('codigo').eq('client_id', session.client_id)
      .eq('es_consolidacion', true).limit(1).maybeSingle(),
    db.from('tasas_cambio').select('moneda_origen, moneda_destino, tasa, fecha')
      .eq('client_id', session.client_id).order('fecha', { ascending: false }),
  ])

  // ── Estado de resultados (devengado) ──
  const resMap = new Map<string, ResultadoMoneda>()
  const getRes = (moneda: string) => {
    let r = resMap.get(moneda)
    if (!r) { r = { moneda, ventas: 0, cobros_directos: 0, total_ingresos: 0, gastos_por_categoria: [], total_gastos: 0, neto: 0 }; resMap.set(moneda, r) }
    return r
  }
  const gastosCat = new Map<string, Map<string, number>>()   // moneda → categoria → monto

  for (const f of (facRes.data ?? []) as { moneda: string; total: number }[]) {
    getRes(f.moneda).ventas += Number(f.total)
  }
  for (const g of (gcRes.data ?? []) as { tipo: string; moneda: string; monto: number; categoria: string | null }[]) {
    if (g.tipo === 'COBRO') {
      getRes(g.moneda).cobros_directos += Number(g.monto)
    } else {
      const cat = g.categoria || 'Sin categoría'
      const m = gastosCat.get(g.moneda) ?? new Map<string, number>()
      m.set(cat, (m.get(cat) ?? 0) + Number(g.monto))
      gastosCat.set(g.moneda, m)
      getRes(g.moneda).total_gastos += Number(g.monto)
    }
  }
  for (const [moneda, cats] of gastosCat) {
    getRes(moneda).gastos_por_categoria = Array.from(cats.entries())
      .map(([categoria, monto]) => ({ categoria, monto }))
      .sort((a, b) => b.monto - a.monto)
  }
  for (const r of resMap.values()) {
    r.total_ingresos = r.ventas + r.cobros_directos
    r.neto = r.total_ingresos - r.total_gastos
  }

  // ── Flujo de caja (efectivo) ──
  const flujoMap = new Map<string, FlujoMoneda>()
  const entradasMap = new Map<string, Map<string, number>>()  // moneda → origen → monto
  const salidasMap  = new Map<string, Map<string, number>>()
  const getFlujo = (moneda: string) => {
    let f = flujoMap.get(moneda)
    if (!f) { f = { moneda, entradas: 0, salidas: 0, neto: 0, detalle_entradas: [], detalle_salidas: [] }; flujoMap.set(moneda, f) }
    return f
  }

  for (const m of (movRes.data ?? []) as { tipo: string; moneda: string; monto: number; origen: string }[]) {
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

  // ── Consolidado (a la moneda es_consolidacion, tasa vigente, TRUNCADO 2 dec) ──
  // Se ancla en los pares "consol→moneda" (1 consol = X moneda); el factor es su
  // inverso. Sin tasa para un par → esa moneda se excluye y se informa.
  const consolCode: string | null = consolRes.data?.codigo ?? null
  const rateMap = new Map<string, number>()
  for (const t of (tasasRes.data ?? [])) {
    const k = `${t.moneda_origen}__${t.moneda_destino}`
    if (!rateMap.has(k)) rateMap.set(k, Number(t.tasa))  // primera = más reciente
  }
  const factorAConsol = (moneda: string): number | null => {
    if (!consolCode) return null
    if (moneda === consolCode) return 1
    const saliente = rateMap.get(`${consolCode}__${moneda}`) // 1 consol = X moneda
    if (saliente && saliente > 0) return 1 / saliente
    const entrante = rateMap.get(`${moneda}__${consolCode}`) // 1 moneda = X consol
    if (entrante && entrante > 0) return entrante
    return null
  }
  // Trunca a 2 decimales sin redondear (con épsilon para absorber ruido de float).
  const trunc2 = (n: number) => (n < 0 ? -1 : 1) * Math.floor(Math.abs(n) * 100 + 1e-6) / 100

  let consolidado: ConsolidadoResumen | null = null
  if (consolCode) {
    const monedasPresentes = new Set<string>([...resultado.map(r => r.moneda), ...flujo.map(f => f.moneda)])
    const redundante = monedasPresentes.size === 1 && monedasPresentes.has(consolCode)
    if (monedasPresentes.size > 0 && !redundante) {
      const excluidas = new Set<string>()
      let ri = 0, rg = 0, hayRes = false
      for (const r of resultado) {
        const f = factorAConsol(r.moneda)
        if (f == null) { excluidas.add(r.moneda); continue }
        ri += r.total_ingresos * f; rg += r.total_gastos * f; hayRes = true
      }
      let fe = 0, fs = 0, hayFlujo = false
      for (const fl of flujo) {
        const f = factorAConsol(fl.moneda)
        if (f == null) { excluidas.add(fl.moneda); continue }
        fe += fl.entradas * f; fs += fl.salidas * f; hayFlujo = true
      }
      const resConsol   = hayRes   ? { total_ingresos: trunc2(ri), total_gastos: trunc2(rg), neto: trunc2(ri - rg) } : null
      const flujoConsol = hayFlujo ? { entradas: trunc2(fe), salidas: trunc2(fs), neto: trunc2(fe - fs) } : null
      if (resConsol || flujoConsol) {
        consolidado = { moneda: consolCode, resultado: resConsol, flujo: flujoConsol, monedasExcluidas: Array.from(excluidas).sort() }
      }
    }
  }

  return {
    desde,
    hasta,
    empresa_id: empresaId,
    empresas:   empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    resultado,
    flujo,
    consolidado,
  }
}
