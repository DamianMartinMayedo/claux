'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { ESTADOS_FACTURA_INGRESO } from '@/lib/contabilidad'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { tieneModulo }       from '@/lib/modulos'
import { enviarEmail }       from '@/lib/email/enviar'
import { envolverEmail }     from '@/lib/email/layout'

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
      .in('estado', ESTADOS_FACTURA_INGRESO)
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

// ── Envío de reportes al asesor ─────────────────────────────────────────────────
// El PDF llega YA generado desde el cliente (mismo que se descarga → paridad visual
// y "el usuario sabe lo que envía"). El CSV técnico se genera aquí en servidor a
// partir de los MISMOS datos re-obtenidos con obtenerReportes (fuente autoritativa).

const ORIGEN_LABEL_SRV: Record<string, string> = {
  MANUAL: 'Manual', COBRO: 'Cobros', PAGO: 'Pagos', TRANSFERENCIA: 'Transferencias',
}

// Número técnico para CSV: 2 decimales con coma (Excel ES). El separador de columna
// es ';', así que la coma decimal no colisiona.
function numCsv(n: number): string { return n.toFixed(2).replace('.', ',') }
// Escapa un valor de celda si contiene ; " o salto de línea.
function celdaCsv(v: string): string {
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

// CSV técnico normalizado: 6 columnas fijas, una fila por cifra, sin banners.
function construirCsvTecnico(
  data: ReportesData,
  empresaLabel: string,
  incluirConsolidado: boolean,
): string {
  const rows: string[][] = [['empresa', 'moneda', 'reporte', 'seccion', 'concepto', 'importe']]
  const push = (moneda: string, reporte: string, seccion: string, concepto: string, importe: number) =>
    rows.push([empresaLabel, moneda, reporte, seccion, concepto, numCsv(importe)])

  const RES = 'Estado de resultados'
  for (const r of data.resultado) {
    push(r.moneda, RES, 'Ingresos', 'Ventas (facturas)', r.ventas)
    push(r.moneda, RES, 'Ingresos', 'Cobros directos', r.cobros_directos)
    push(r.moneda, RES, 'Ingresos', 'Total ingresos', r.total_ingresos)
    for (const g of r.gastos_por_categoria) push(r.moneda, RES, 'Gastos', g.categoria, g.monto)
    push(r.moneda, RES, 'Gastos', 'Total gastos', r.total_gastos)
    push(r.moneda, RES, 'Resultado', 'Resultado neto', r.neto)
  }

  const FLU = 'Flujo de caja'
  for (const f of data.flujo) {
    for (const e of f.detalle_entradas) push(f.moneda, FLU, 'Entradas', ORIGEN_LABEL_SRV[e.origen] ?? e.origen, e.monto)
    push(f.moneda, FLU, 'Entradas', 'Total entradas', f.entradas)
    for (const s of f.detalle_salidas) push(f.moneda, FLU, 'Salidas', ORIGEN_LABEL_SRV[s.origen] ?? s.origen, s.monto)
    push(f.moneda, FLU, 'Salidas', 'Total salidas', f.salidas)
    push(f.moneda, FLU, 'Flujo', 'Flujo neto', f.neto)
  }

  const c = data.consolidado
  if (incluirConsolidado && c) {
    if (c.resultado) {
      push(c.moneda, 'Consolidado', 'Estado de resultados', 'Ingresos', c.resultado.total_ingresos)
      push(c.moneda, 'Consolidado', 'Estado de resultados', 'Gastos', c.resultado.total_gastos)
      push(c.moneda, 'Consolidado', 'Estado de resultados', 'Resultado neto', c.resultado.neto)
    }
    if (c.flujo) {
      push(c.moneda, 'Consolidado', 'Flujo de caja', 'Entradas', c.flujo.entradas)
      push(c.moneda, 'Consolidado', 'Flujo de caja', 'Salidas', c.flujo.salidas)
      push(c.moneda, 'Consolidado', 'Flujo de caja', 'Flujo neto', c.flujo.neto)
    }
  }

  // BOM para que Excel (ES) respete acentos; separador ; para locale español.
  return '﻿' + rows.map(r => r.map(celdaCsv).join(';')).join('\r\n')
}

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
  incluirCSV:         boolean
  nota?:              string
  pdfBase64?:         string   // sin prefijo data:; obligatorio si incluirPDF
  pdfNombre?:         string
  csvNombre?:         string
}

export async function enviarReportesAsesor(
  input: EnviarReportesAsesorInput,
): Promise<{ ok: boolean; error?: string; email?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  if (!input.incluirPDF && !input.incluirCSV) {
    return { ok: false, error: 'Selecciona al menos un archivo (PDF o CSV).' }
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
  const data = await obtenerReportes(input.desde, input.hasta, input.empresa_id)
  if (!data) return { ok: false, error: 'No se pudieron leer los reportes.' }

  const empresaLabel = input.empresa_id
    ? (data.empresas.find(e => e.empresa_id === input.empresa_id)?.nombre ?? input.empresa_id)
    : 'Todas las empresas'

  const { data: cli } = await db.from('clients')
    .select('nombre_empresa').eq('client_id', session.client_id).maybeSingle()
  const negocio = (cli?.nombre_empresa as string) || 'el negocio'

  // Adjuntos
  const attachments: { filename: string; content: string }[] = []
  if (input.incluirPDF && input.pdfBase64) {
    attachments.push({ filename: (input.pdfNombre || 'reportes.pdf').replace(/[^\w.-]+/g, '_'), content: input.pdfBase64 })
  }
  if (input.incluirCSV) {
    const csv = construirCsvTecnico(data, empresaLabel, input.incluirConsolidado)
    attachments.push({
      filename: (input.csvNombre || 'reportes.csv').replace(/[^\w.-]+/g, '_'),
      content:  Buffer.from(csv, 'utf-8').toString('base64'),
    })
  }
  if (!attachments.length) return { ok: false, error: 'No hay nada que adjuntar.' }

  // Resumen "lo que se envía": neto por moneda + consolidado si se incluye.
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
