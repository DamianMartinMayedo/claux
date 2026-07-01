'use client'

import { useState, useTransition } from 'react'
import { useRouter }               from 'next/navigation'
import { Download, ChevronDown, BarChart3, Search } from 'lucide-react'
import type { ReportesData }       from '@/app/actions/portal/reportes'
import EmpresaPills                from '@/components/portal/EmpresaPills'
import { useEmpresas }             from '@/components/portal/EmpresaColorContext'
import IaTouchpoint                from '@/components/portal/ia/IaTouchpoint'

// ── Constantes ────────────────────────────────────────────────────────────────

const ORIGEN_LABEL: Record<string, string> = {
  MANUAL: 'Manual', COBRO: 'Cobros', PAGO: 'Pagos', TRANSFERENCIA: 'Transferencias',
}

// Interfaz mínima de jsPDF (su .d.ts empaquetado no es un módulo ES y TS lo rechaza).
interface JsPdfDoc {
  internal: { pageSize: { getWidth(): number; getHeight(): number } }
  setFont(family: string, style: string): void
  setFontSize(n: number): void
  setTextColor(r: number, g: number, b: number): void
  setDrawColor(r: number, g: number, b: number): void
  text(text: string, x: number, y: number, opts?: { align?: string }): void
  line(x1: number, y1: number, x2: number, y2: number): void
  addPage(): void
  save(filename: string): void
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
  const nombreArchivo = `reportes_${data.desde}_${data.hasta}`

  // PDF construido con texto real (jsPDF), no una captura de la página.
  async function descargarPDF() {
    setMenuOpen(false)
    if (descargando) return
    setDescargando(true)
    try {
      // jsPDF empaqueta un .d.ts que TS no reconoce como módulo: casteamos a la interfaz mínima.
      const mod = await import('jspdf') as unknown as { jsPDF: new (o: object) => JsPdfDoc }
      const doc: JsPdfDoc = new mod.jsPDF({ unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()
      const M = 16
      const right = pageW - M
      let y = M

      const TEAL: [number, number, number] = [13, 148, 136]
      const DARK: [number, number, number] = [28, 27, 22]
      const GRAY: [number, number, number] = [107, 104, 98]

      const ensure = (space: number) => { if (y + space > pageH - M) { doc.addPage(); y = M } }
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
        doc.setDrawColor(216, 213, 204); doc.line(M, y, right, y)
        y += 5
      }
      const totalRow = (label: string, amount: string) => {
        ensure(8)
        doc.setDrawColor(DARK[0], DARK[1], DARK[2]); doc.line(M, y - 1, right, y - 1)
        row(label, amount, { bold: true, color: TEAL, gap: 9 })
      }

      // Cabecera
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
      doc.setTextColor(TEAL[0], TEAL[1], TEAL[2]); doc.text('CLAUX', M, y); y += 6
      doc.setFontSize(18); doc.setTextColor(DARK[0], DARK[1], DARK[2])
      doc.text('Reportes financieros', M, y); y += 6
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
      doc.text(empresaNombre, M, y)
      doc.text(`${formatFechaCorta(data.desde)} - ${formatFechaCorta(data.hasta)}`, right, y, { align: 'right' })
      y += 3
      doc.setDrawColor(DARK[0], DARK[1], DARK[2]); doc.line(M, y, right, y); y += 9

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

      {/* Fila de rango de fechas + empresa */}
      <div className="ter-toolbar rep-rango-row">
        <input className="input ter-filter-select" type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        <span className="rep-rango-sep">–</span>
        <input className="input ter-filter-select" type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        <EmpresaPills
          empresas={empresasFiltro}
          value={empresa}
          onChange={id => { setEmpresa(id); navegar(desde, hasta, id) }}
          todasLabel="Todas las empresas"
        />
        <button className="btn btn-primary btn-sm" onClick={aplicar} disabled={isPending}>
          {isPending ? <><span className="spinner spinner-sm" /> …</> : 'Aplicar'}
        </button>
        <span className="rep-periodo-actual">{formatFechaCorta(data.desde)} – {formatFechaCorta(data.hasta)}</span>
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
    </div>
  )
}
