'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter }               from 'next/navigation'
import type { ReportesData }       from '@/app/actions/portal/reportes'

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

// ── Vista ─────────────────────────────────────────────────────────────────────

export default function ReportesView({ data }: { data: ReportesData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [desde,   setDesde]   = useState(data.desde)
  const [hasta,   setHasta]   = useState(data.hasta)
  const [empresa, setEmpresa] = useState(data.empresa_id)
  const [query,   setQuery]   = useState('')

  const q = query.trim().toLowerCase()
  const filtrarCategorias = (cats: { categoria: string; monto: number }[]) =>
    q ? cats.filter(c => c.categoria.toLowerCase().includes(q)) : cats

  // ── Descarga ──────────────────────────────────────────────────────────────
  const printRef = useRef<HTMLDivElement>(null)
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [descargando, setDescargando] = useState(false)

  const empresaNombre = data.empresa_id
    ? (data.empresas.find(e => e.empresa_id === data.empresa_id)?.nombre ?? '')
    : 'Todas las empresas'
  const nombreArchivo = `reportes_${data.desde}_${data.hasta}`

  async function descargarPDF() {
    setMenuOpen(false)
    if (descargando || !printRef.current) return
    setDescargando(true)
    try {
      const html2pdf = (await import('html2pdf.js')).default
      await html2pdf().set({
        margin:      [8, 8, 8, 8],
        filename:    `${nombreArchivo}.pdf`,
        image:       { type: 'jpeg', quality: 0.97 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(printRef.current).save()
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

  function aplicar() { navegar(desde, hasta, empresa) }

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
          <h1 className="page-title">Reportes financieros</h1>
          <p className="page-subtitle">Estado de resultados (devengado) y flujo de caja (efectivo) del período seleccionado.</p>
        </div>
        {!sinDatos && (
          <div className="rep-dl">
            <button className="btn btn-secondary" onClick={() => setMenuOpen(v => !v)} disabled={descargando}>
              <IconDownload /> {descargando ? 'Generando…' : 'Descargar'}
              <IconChevron />
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
          <IconSearch />
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

      {/* Fila de rango de fechas + empresa */}
      <div className="ter-toolbar rep-rango-row">
        <input className="input ter-filter-select" type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        <span className="rep-rango-sep">–</span>
        <input className="input ter-filter-select" type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        {data.empresas.length > 1 && (
          <select className="input ter-filter-select" value={empresa} onChange={e => setEmpresa(e.target.value)}>
            <option value="">Todas las empresas</option>
            {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
          </select>
        )}
        <button className="btn btn-primary btn-sm" onClick={aplicar} disabled={isPending}>
          {isPending ? <><span className="spinner spinner-sm" /> …</> : 'Aplicar'}
        </button>
        <span className="rep-periodo-actual">{formatFechaCorta(data.desde)} – {formatFechaCorta(data.hasta)}</span>
      </div>

      {sinDatos ? (
        <div className="card mon-empty">
          <IconChart />
          <p>No hay movimientos ni documentos en este período.</p>
        </div>
      ) : (
        <>
          {/* ── Estado de resultados ── */}
          <h2 className="tes-section-title rep-titulo">Estado de resultados</h2>
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
        </>
      )}

      {/* Documento imprimible (oculto fuera de pantalla; lo consume html2pdf) */}
      <div className="rep-print" ref={printRef} aria-hidden="true">
        <div className="rep-print-head">
          <div className="rep-print-brand">CLAUX</div>
          <h1 className="rep-print-title">Reportes financieros</h1>
          <div className="rep-print-meta">
            <span>{empresaNombre}</span>
            <span>{formatFechaCorta(data.desde)} – {formatFechaCorta(data.hasta)}</span>
          </div>
        </div>

        <h2 className="rep-print-h2">Estado de resultados</h2>
        {data.resultado.length === 0 ? <p className="rep-print-empty">Sin ingresos ni gastos en el período.</p> : data.resultado.map(r => (
          <table className="rep-print-table" key={`pr-${r.moneda}`}>
            <thead><tr><th>{r.moneda}</th><th className="rep-print-num">Importe</th></tr></thead>
            <tbody>
              <tr className="rep-print-section"><td>Ingresos</td><td className="rep-print-num">{formatMonto(r.total_ingresos)}</td></tr>
              <tr><td>Ventas (facturas)</td><td className="rep-print-num">{formatMonto(r.ventas)}</td></tr>
              <tr><td>Cobros directos</td><td className="rep-print-num">{formatMonto(r.cobros_directos)}</td></tr>
              <tr className="rep-print-section"><td>Gastos</td><td className="rep-print-num">{formatMonto(r.total_gastos)}</td></tr>
              {r.gastos_por_categoria.map(g => <tr key={g.categoria}><td>{g.categoria}</td><td className="rep-print-num">{formatMonto(g.monto)}</td></tr>)}
              <tr className="rep-print-total"><td>Resultado neto</td><td className="rep-print-num">{formatMonto(r.neto)}</td></tr>
            </tbody>
          </table>
        ))}

        <h2 className="rep-print-h2">Flujo de caja</h2>
        {data.flujo.length === 0 ? <p className="rep-print-empty">Sin movimientos de efectivo en el período.</p> : data.flujo.map(f => (
          <table className="rep-print-table" key={`pf-${f.moneda}`}>
            <thead><tr><th>{f.moneda}</th><th className="rep-print-num">Importe</th></tr></thead>
            <tbody>
              <tr className="rep-print-section"><td>Entradas</td><td className="rep-print-num">{formatMonto(f.entradas)}</td></tr>
              {f.detalle_entradas.map(e => <tr key={e.origen}><td>{ORIGEN_LABEL[e.origen] ?? e.origen}</td><td className="rep-print-num">{formatMonto(e.monto)}</td></tr>)}
              <tr className="rep-print-section"><td>Salidas</td><td className="rep-print-num">{formatMonto(f.salidas)}</td></tr>
              {f.detalle_salidas.map(s => <tr key={s.origen}><td>{ORIGEN_LABEL[s.origen] ?? s.origen}</td><td className="rep-print-num">{formatMonto(s.monto)}</td></tr>)}
              <tr className="rep-print-total"><td>Flujo neto</td><td className="rep-print-num">{formatMonto(f.neto)}</td></tr>
            </tbody>
          </table>
        ))}
      </div>
    </div>
  )
}

function IconDownload() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
}
function IconChevron() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="6 9 12 15 18 9"/></svg>
}
function IconChart() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" opacity="0.2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
}
function IconSearch() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
}
