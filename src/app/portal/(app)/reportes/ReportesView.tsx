'use client'

import { useState, useTransition } from 'react'
import { useRouter }               from 'next/navigation'
import { Download, ChevronDown, BarChart3, Search } from 'lucide-react'
import type { ReportesData }       from '@/app/actions/portal/reportes'
import EmpresaPills                from '@/components/portal/EmpresaPills'
import { useEmpresas }             from '@/components/portal/EmpresaColorContext'
import IaTouchpoint                from '@/components/portal/ia/IaTouchpoint'
import { crearDoc, cabeceraReporte, sellarPie, MARCA, RESERVA_PIE } from '@/lib/pdf/documento'

// ── Constantes ────────────────────────────────────────────────────────────────

const ORIGEN_LABEL: Record<string, string> = {
  MANUAL: 'Manual', COBRO: 'Cobros', PAGO: 'Pagos', TRANSFERENCIA: 'Transferencias',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatFechaCorta(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
// Normaliza un nombre para usarlo en el nombre de archivo (sin acentos ni símbolos).
function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'reporte'
}

// ── Vista ─────────────────────────────────────────────────────────────────────

export default function ReportesView({ data }: { data: ReportesData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [desde,   setDesde]   = useState(data.desde)
  const [hasta,   setHasta]   = useState(data.hasta)
  const [empresa, setEmpresa] = useState(data.empresa_id)
  const [query,   setQuery]   = useState('')

  const { colorOf } = useEmpresas()
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))

  const q = query.trim().toLowerCase()
  const filtrarCategorias = (cats: { categoria: string; monto: number }[]) =>
    q ? cats.filter(c => c.categoria.toLowerCase().includes(q)) : cats

  // ── Descarga ──────────────────────────────────────────────────────────────
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [descargando, setDescargando] = useState(false)

  const empresaNombre = data.empresa_id
    ? (data.empresas.find(e => e.empresa_id === data.empresa_id)?.nombre ?? '')
    : 'Todas las empresas'
  // Nombre de archivo: reportes_<empresa|todas>_<desde>_<hasta>
  const empresaSlug = data.empresa_id ? slug(empresaNombre) : 'todas'
  const nombreArchivo = `reportes_${empresaSlug}_${data.desde}_${data.hasta}`

  // PDF construido con texto real (jsPDF), no una captura de la página.
  async function descargarPDF() {
    setMenuOpen(false)
    if (descargando) return
    setDescargando(true)
    try {
      const doc   = await crearDoc()
      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()
      const M     = 16
      const right = pageW - M
      let y = M

      const TEAL = MARCA.teal
      const DARK = MARCA.dark
      const GRAY = MARCA.muted

      const ensure = (space: number) => { if (y + space > pageH - RESERVA_PIE - 2) { doc.addPage(); y = M } }
      const row = (
        label: string, amount: string,
        opts: { bold?: boolean; color?: [number, number, number]; indent?: boolean; gap?: number } = {},
      ) => {
        ensure(7)
        doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
        doc.setFontSize(10)
        const c = opts.color ?? DARK
        doc.setTextColor(c[0], c[1], c[2])
        doc.text(label, opts.indent ? M + 4 : M, y)
        if (amount) doc.text(amount, right, y, { align: 'right' })
        y += opts.gap ?? 6
      }
      const heading = (text: string) => {
        ensure(12)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
        doc.setTextColor(DARK[0], DARK[1], DARK[2])
        doc.text(text, M, y); y += 7
      }
      const monedaHead = (m: string) => {
        ensure(9)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
        doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
        doc.text(m, M, y); doc.text('Importe', right, y, { align: 'right' })
        y += 2
        doc.setDrawColor(MARCA.divider[0], MARCA.divider[1], MARCA.divider[2]); doc.setLineWidth(0.2)
        doc.line(M, y, right, y)
        y += 5
      }
      const totalRow = (label: string, amount: string) => {
        ensure(13)
        // Regla arriba del total y luego el texto debajo (evita que la línea
        // atraviese las letras).
        doc.setDrawColor(DARK[0], DARK[1], DARK[2]); doc.setLineWidth(0.4)
        doc.line(M, y, right, y)
        y += 5
        row(label, amount, { bold: true, color: TEAL, gap: 9 })
      }

      y = cabeceraReporte(doc, {
        titulo:    'Reportes financieros',
        izquierda: empresaNombre,
        derecha:   `${formatFechaCorta(data.desde)} — ${formatFechaCorta(data.hasta)}`,
      })

      // Estado de resultados
      heading('Estado de resultados')
      if (data.resultado.length === 0) row('Sin ingresos ni gastos en el período.', '', { color: GRAY })
      for (const r of data.resultado) {
        monedaHead(r.moneda)
        row('Ingresos', formatMonto(r.total_ingresos), { bold: true })
        row('Ventas (facturas)', formatMonto(r.ventas), { indent: true })
        row('Cobros directos', formatMonto(r.cobros_directos), { indent: true })
        row('Gastos', formatMonto(r.total_gastos), { bold: true })
        for (const g of r.gastos_por_categoria) row(g.categoria, formatMonto(g.monto), { indent: true })
        totalRow('Resultado neto', formatMonto(r.neto))
      }

      // Flujo de caja
      y += 2
      heading('Flujo de caja')
      if (data.flujo.length === 0) row('Sin movimientos de efectivo en el período.', '', { color: GRAY })
      for (const f of data.flujo) {
        monedaHead(f.moneda)
        row('Entradas', formatMonto(f.entradas), { bold: true })
        for (const e of f.detalle_entradas) row(ORIGEN_LABEL[e.origen] ?? e.origen, formatMonto(e.monto), { indent: true })
        row('Salidas', formatMonto(f.salidas), { bold: true })
        for (const s of f.detalle_salidas) row(ORIGEN_LABEL[s.origen] ?? s.origen, formatMonto(s.monto), { indent: true })
        totalRow('Flujo neto', formatMonto(f.neto))
      }

      // ── Consolidado (recuadro gris claro) ──
      const c = data.consolidado
      if (c) {
        const lineas: { label: string; val: string; bold?: boolean; muted?: boolean; gap?: number }[] = []
        if (c.resultado) {
          lineas.push({ label: 'Estado de resultados', val: '', bold: true, muted: true })
          lineas.push({ label: 'Ingresos', val: formatMonto(c.resultado.total_ingresos) })
          lineas.push({ label: 'Gastos', val: formatMonto(c.resultado.total_gastos) })
          lineas.push({ label: 'Resultado neto', val: formatMonto(c.resultado.neto), bold: true })
        }
        if (c.flujo) {
          lineas.push({ label: 'Flujo de caja', val: '', bold: true, muted: true, gap: 7 })
          lineas.push({ label: 'Entradas', val: formatMonto(c.flujo.entradas) })
          lineas.push({ label: 'Salidas', val: formatMonto(c.flujo.salidas) })
          lineas.push({ label: 'Flujo neto', val: formatMonto(c.flujo.neto), bold: true })
        }
        const bodyH = lineas.reduce((s, l) => s + (l.gap ?? 5.5), 0)
        const boxH  = 14 + bodyH + (c.monedasExcluidas.length ? 6 : 0) + 4
        y += 6
        if (y + boxH > pageH - RESERVA_PIE - 2) { doc.addPage(); y = M }
        doc.setFillColor(MARCA.surface[0], MARCA.surface[1], MARCA.surface[2])
        doc.setDrawColor(MARCA.divider[0], MARCA.divider[1], MARCA.divider[2]); doc.setLineWidth(0.2)
        doc.roundedRect(M, y, right - M, boxH, 2, 2, 'FD')
        const padX = M + 5
        let yy = y + 8
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
        doc.setTextColor(DARK[0], DARK[1], DARK[2]); doc.text(`Consolidado en ${c.moneda}`, padX, yy)
        yy += 5
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
        doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
        doc.text('Convertido a la tasa vigente', padX, yy)
        yy += 6
        for (const l of lineas) {
          doc.setFont('helvetica', l.bold ? 'bold' : 'normal'); doc.setFontSize(l.muted ? 8.5 : 9.5)
          const col = l.muted ? GRAY : DARK
          doc.setTextColor(col[0], col[1], col[2])
          doc.text(l.label, l.muted ? padX : padX + 3, yy)
          if (l.val) doc.text(l.val, right - 5, yy, { align: 'right' })
          yy += l.gap ?? 5.5
        }
        if (c.monedasExcluidas.length) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
          doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
          doc.text(`Sin tasa hacia ${c.moneda}: ${c.monedasExcluidas.join(', ')}`, padX, yy)
        }
        y += boxH
      }

      sellarPie(doc)
      doc.save(`${nombreArchivo}.pdf`)
    } finally {
      setDescargando(false)
    }
  }

  function descargarCSV() {
    setMenuOpen(false)
    const num = (n: number) => n.toFixed(2).replace('.', ',')
    const rows: string[] = []
    rows.push('Reportes financieros')
    rows.push(`Período;${data.desde};${data.hasta}`)
    rows.push(`Empresa;${empresaNombre}`)
    rows.push('')
    rows.push('ESTADO DE RESULTADOS')
    rows.push('Moneda;Concepto;Importe')
    for (const r of data.resultado) {
      rows.push(`${r.moneda};Ventas (facturas);${num(r.ventas)}`)
      rows.push(`${r.moneda};Cobros directos;${num(r.cobros_directos)}`)
      rows.push(`${r.moneda};Total ingresos;${num(r.total_ingresos)}`)
      for (const g of r.gastos_por_categoria) rows.push(`${r.moneda};Gasto: ${g.categoria};${num(g.monto)}`)
      rows.push(`${r.moneda};Total gastos;${num(r.total_gastos)}`)
      rows.push(`${r.moneda};Resultado neto;${num(r.neto)}`)
    }
    rows.push('')
    rows.push('FLUJO DE CAJA')
    rows.push('Moneda;Movimiento;Origen;Importe')
    for (const f of data.flujo) {
      for (const e of f.detalle_entradas) rows.push(`${f.moneda};Entrada;${ORIGEN_LABEL[e.origen] ?? e.origen};${num(e.monto)}`)
      rows.push(`${f.moneda};Total entradas;;${num(f.entradas)}`)
      for (const s of f.detalle_salidas) rows.push(`${f.moneda};Salida;${ORIGEN_LABEL[s.origen] ?? s.origen};${num(s.monto)}`)
      rows.push(`${f.moneda};Total salidas;;${num(f.salidas)}`)
      rows.push(`${f.moneda};Flujo neto;;${num(f.neto)}`)
    }
    if (data.consolidado) {
      const c = data.consolidado
      rows.push('')
      rows.push(`CONSOLIDADO EN ${c.moneda} (tasa vigente)`)
      rows.push('Sección;Concepto;Importe')
      if (c.resultado) {
        rows.push(`Estado de resultados;Ingresos;${num(c.resultado.total_ingresos)}`)
        rows.push(`Estado de resultados;Gastos;${num(c.resultado.total_gastos)}`)
        rows.push(`Estado de resultados;Resultado neto;${num(c.resultado.neto)}`)
      }
      if (c.flujo) {
        rows.push(`Flujo de caja;Entradas;${num(c.flujo.entradas)}`)
        rows.push(`Flujo de caja;Salidas;${num(c.flujo.salidas)}`)
        rows.push(`Flujo de caja;Flujo neto;${num(c.flujo.neto)}`)
      }
      if (c.monedasExcluidas.length) rows.push(`Sin tasa hacia ${c.moneda};${c.monedasExcluidas.join(' ')};`)
    }
    // BOM para que Excel (ES) respete acentos; separador ; para locale español
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `${nombreArchivo}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  function navegar(d: string, h: string, e: string) {
    const params = new URLSearchParams({ desde: d, hasta: h })
    if (e) params.set('empresa', e)
    startTransition(() => router.push(`/portal/reportes?${params.toString()}`))
  }

  function rangoPreset(tipo: 'mes' | 'mes_pasado' | 'anio'): { d: string; h: string } {
    const now = new Date()
    let d: Date, h: Date
    if (tipo === 'mes')             { d = new Date(now.getFullYear(), now.getMonth(), 1);     h = new Date(now.getFullYear(), now.getMonth() + 1, 0) }
    else if (tipo === 'mes_pasado') { d = new Date(now.getFullYear(), now.getMonth() - 1, 1); h = new Date(now.getFullYear(), now.getMonth(), 0) }
    else                            { d = new Date(now.getFullYear(), 0, 1);                  h = new Date(now.getFullYear(), 11, 31) }
    return { d: fmt(d), h: fmt(h) }
  }

  function preset(tipo: 'mes' | 'mes_pasado' | 'anio') {
    const { d, h } = rangoPreset(tipo)
    setDesde(d); setHasta(h); navegar(d, h, empresa)
  }

  // ¿Qué preset coincide con el período aplicado? (para resaltar el botón activo)
  const presetActivo = (tipo: 'mes' | 'mes_pasado' | 'anio') => {
    const { d, h } = rangoPreset(tipo)
    return data.desde === d && data.hasta === h
  }

  const sinDatos = data.resultado.length === 0 && data.flujo.length === 0

  return (
    <div className="view-container">

      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Reportes financieros</h1>
            <IaTouchpoint tipo="proyeccion" descripcion="una proyección de tus ingresos" />
          </div>
          <p className="page-subtitle">Estado de resultados (devengado) y flujo de caja (efectivo) del período seleccionado.</p>
        </div>
        {!sinDatos && (
          <div className="rep-dl">
            <button className="btn btn-secondary" onClick={() => setMenuOpen(v => !v)} disabled={descargando}>
              <Download size={14} /> {descargando ? 'Generando…' : 'Descargar'}
              <ChevronDown size={13} />
            </button>
            {menuOpen && (
              <>
                <div className="rep-dl-overlay" onClick={() => setMenuOpen(false)} />
                <div className="rep-dl-menu">
                  <button className="dropdown-item" onClick={descargarPDF}>Descargar PDF</button>
                  <button className="dropdown-item" onClick={descargarCSV}>Descargar Excel (CSV)</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Fila de filtros: buscador + accesos rápidos de período */}
      <div className="ter-toolbar">
        <div className="ter-search-wrap">
          <Search size={15} />
          <input
            type="search"
            className="ter-search"
            placeholder="Buscar categoría de gasto…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <button className={`cxx-chip${presetActivo('mes') ? ' active' : ''}`} onClick={() => preset('mes')} disabled={isPending}>Este mes</button>
        <button className={`cxx-chip${presetActivo('mes_pasado') ? ' active' : ''}`} onClick={() => preset('mes_pasado')} disabled={isPending}>Mes pasado</button>
        <button className={`cxx-chip${presetActivo('anio') ? ' active' : ''}`} onClick={() => preset('anio')} disabled={isPending}>Este año</button>
      </div>

      {/* Fila de rango de fechas + empresa — se aplica solo al cambiar (sin botón) */}
      <div className="ter-toolbar rep-rango-row">
        <input
          className="input ter-filter-select" type="date" value={desde}
          onChange={e => { const v = e.target.value; setDesde(v); if (v && hasta) navegar(v, hasta, empresa) }}
        />
        <span className="rep-rango-sep">–</span>
        <input
          className="input ter-filter-select" type="date" value={hasta}
          onChange={e => { const v = e.target.value; setHasta(v); if (desde && v) navegar(desde, v, empresa) }}
        />
        <EmpresaPills
          empresas={empresasFiltro}
          value={empresa}
          onChange={id => { setEmpresa(id); navegar(desde, hasta, id) }}
          todasLabel="Todas las empresas"
        />
      </div>

      {sinDatos ? (
        <div className="card mon-empty">
          <BarChart3 size={40} strokeWidth={1} opacity={0.2} />
          <p>No hay movimientos ni documentos en este período.</p>
        </div>
      ) : (
        <>
          {/* ── Estado de resultados ── */}
          <h2 className="tes-section-title rep-titulo">Estado de resultados</h2>
          <p className="rep-nota">
            {isPending && <span className="spinner spinner-sm" />}
            {formatFechaCorta(data.desde)} – {formatFechaCorta(data.hasta)}
          </p>
          {data.resultado.length === 0 ? (
            <div className="card mon-empty"><p>Sin ingresos ni gastos devengados en el período.</p></div>
          ) : (
            <div className="rep-grid">
              {data.resultado.map(r => (
                <div key={r.moneda} className="rep-card">
                  <div className="rep-card-head">
                    <span className="rep-moneda">{r.moneda}</span>
                    <span className={`rep-neto ${r.neto >= 0 ? 'rep-pos' : 'rep-neg'}`}>{formatMonto(r.neto)}</span>
                  </div>
                  <div className="rep-card-label">Resultado neto</div>

                  <div className="rep-block">
                    <div className="rep-line rep-line-head"><span>Ingresos</span><strong>{formatMonto(r.total_ingresos)}</strong></div>
                    <div className="rep-line rep-sub"><span>Ventas (facturas)</span><span>{formatMonto(r.ventas)}</span></div>
                    <div className="rep-line rep-sub"><span>Cobros directos</span><span>{formatMonto(r.cobros_directos)}</span></div>
                  </div>

                  <div className="rep-block">
                    <div className="rep-line rep-line-head"><span>Gastos</span><strong>{formatMonto(r.total_gastos)}</strong></div>
                    {r.gastos_por_categoria.length === 0
                      ? <div className="rep-line rep-sub"><span>Sin gastos</span><span>—</span></div>
                      : (() => {
                          const cats = filtrarCategorias(r.gastos_por_categoria)
                          if (cats.length === 0) return <div className="rep-line rep-sub"><span>Sin coincidencias</span><span>—</span></div>
                          return cats.map(g => (
                            <div key={g.categoria} className="rep-line rep-sub"><span>{g.categoria}</span><span>{formatMonto(g.monto)}</span></div>
                          ))
                        })()}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Flujo de caja ── */}
          <h2 className="tes-section-title rep-titulo rep-titulo-mt">Flujo de caja</h2>
          <p className="rep-nota">Movimientos reales de efectivo (excluye transferencias internas).</p>
          {data.flujo.length === 0 ? (
            <div className="card mon-empty"><p>Sin movimientos de efectivo en el período.</p></div>
          ) : (
            <div className="rep-grid">
              {data.flujo.map(f => (
                <div key={f.moneda} className="rep-card">
                  <div className="rep-card-head">
                    <span className="rep-moneda">{f.moneda}</span>
                    <span className={`rep-neto ${f.neto >= 0 ? 'rep-pos' : 'rep-neg'}`}>{formatMonto(f.neto)}</span>
                  </div>
                  <div className="rep-card-label">Flujo neto</div>

                  <div className="rep-block">
                    <div className="rep-line rep-line-head rep-in"><span>Entradas</span><strong>{formatMonto(f.entradas)}</strong></div>
                    {f.detalle_entradas.map(e => (
                      <div key={e.origen} className="rep-line rep-sub"><span>{ORIGEN_LABEL[e.origen] ?? e.origen}</span><span>{formatMonto(e.monto)}</span></div>
                    ))}
                  </div>

                  <div className="rep-block">
                    <div className="rep-line rep-line-head rep-out"><span>Salidas</span><strong>{formatMonto(f.salidas)}</strong></div>
                    {f.detalle_salidas.map(s => (
                      <div key={s.origen} className="rep-line rep-sub"><span>{ORIGEN_LABEL[s.origen] ?? s.origen}</span><span>{formatMonto(s.monto)}</span></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Consolidado (conversión a la moneda de consolidación) ── */}
          {data.consolidado && (
            <div className="rep-consol">
              <div className="rep-consol-head">
                <span className="rep-consol-title">Consolidado en {data.consolidado.moneda}</span>
                <span className="rep-consol-note">Convertido a la tasa vigente</span>
              </div>
              <div className="rep-consol-grid">
                {data.consolidado.resultado && (
                  <div className="rep-consol-block">
                    <div className="rep-consol-block-title">Estado de resultados</div>
                    <div className="rep-line"><span>Ingresos</span><span>{formatMonto(data.consolidado.resultado.total_ingresos)}</span></div>
                    <div className="rep-line"><span>Gastos</span><span>{formatMonto(data.consolidado.resultado.total_gastos)}</span></div>
                    <div className="rep-line rep-consol-neto"><span>Resultado neto</span><strong>{formatMonto(data.consolidado.resultado.neto)}</strong></div>
                  </div>
                )}
                {data.consolidado.flujo && (
                  <div className="rep-consol-block">
                    <div className="rep-consol-block-title">Flujo de caja</div>
                    <div className="rep-line"><span>Entradas</span><span>{formatMonto(data.consolidado.flujo.entradas)}</span></div>
                    <div className="rep-line"><span>Salidas</span><span>{formatMonto(data.consolidado.flujo.salidas)}</span></div>
                    <div className="rep-line rep-consol-neto"><span>Flujo neto</span><strong>{formatMonto(data.consolidado.flujo.neto)}</strong></div>
                  </div>
                )}
              </div>
              {data.consolidado.monedasExcluidas.length > 0 && (
                <p className="rep-consol-excl">
                  Sin tasa hacia {data.consolidado.moneda}, no incluidas: {data.consolidado.monedasExcluidas.join(', ')}.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
