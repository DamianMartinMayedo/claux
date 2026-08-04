'use client'

import { useMemo, useState } from 'react'
import { type RrhhPageData } from '@/app/actions/portal/rrhh'
import { BarChart3, Download, ChevronDown } from 'lucide-react'
import { EmpresaTag }   from '@/components/portal/EmpresaTag'
import EmpresaPills     from '@/components/portal/EmpresaPills'
import { useEmpresas }  from '@/components/portal/EmpresaColorContext'
import { crearDoc, cabeceraReporte, sellarPie, MARCA, RESERVA_PIE } from '@/lib/pdf/documento'
import { aniosDisponibles, construirReportesRrhh } from '@/lib/rrhh/reportes'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatMes(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m) return periodo
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Página: Reportes de RRHH ─────────────────────────────────────────────────────

export default function ReportesView({ data }: { data: RrhhPageData }) {
  const anioActual = String(new Date().getFullYear())
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [anio, setAnio] = useState(anioActual)

  const { colorOf } = useEmpresas()
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))

  const anios = useMemo(() => aniosDisponibles(data.nominas, anioActual), [data.nominas, anioActual])

  // TODA la agregación sale de `src/lib/rrhh/reportes.ts`. Antes esta vista tenía su
  // propia copia en `useMemo`s y el módulo compartido no lo importaba NADIE, así que
  // había dos implementaciones del mismo número y solo una se enseñaba — la que
  // sumaba NETOS y por tanto rebajaba el coste de personal con cada retención.
  const { plantilla, altas, bajas, costeAnual, costePorMes, porDepto, porEmpresa } = useMemo(
    () => construirReportesRrhh(
      data.empleados,
      data.nominas,
      data.empresas,
      { empresaId: filtroEmpresa, anio },
    ),
    [data.empleados, data.nominas, data.empresas, filtroEmpresa, anio],
  )

  const sinDatos = data.empleados.length === 0

  // ── Descarga ──────────────────────────────────────────────────────────────
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [descargando, setDescargando] = useState(false)

  const empresaNombre = filtroEmpresa
    ? (data.empresas.find(e => e.empresa_id === filtroEmpresa)?.nombre ?? '')
    : 'Todas las empresas'
  const nombreArchivo = `reportes_rrhh_${anio}`
  const lineaMoneda = (ms: { moneda: string; monto: number }[]) =>
    ms.length ? ms.map(m => `${formatMonto(m.monto)} ${m.moneda}`).join(' · ') : '—'

  async function descargarPDF() {
    setMenuOpen(false)
    if (descargando) return
    setDescargando(true)
    try {
      const doc   = await crearDoc()
      const pageH = doc.internal.pageSize.getHeight()
      const M = 16, right = doc.internal.pageSize.getWidth() - M
      let y = M
      const TEAL = MARCA.teal
      const DARK = MARCA.dark
      const GRAY = MARCA.muted

      const ensure = (s: number) => { if (y + s > pageH - RESERVA_PIE - 2) { doc.addPage(); y = M } }
      const row = (label: string, amount: string, opts: { bold?: boolean; color?: [number, number, number]; indent?: boolean } = {}) => {
        ensure(7)
        doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(10)
        const c = opts.color ?? DARK; doc.setTextColor(c[0], c[1], c[2])
        doc.text(label, opts.indent ? M + 4 : M, y)
        if (amount) doc.text(amount, right, y, { align: 'right' })
        y += 6
      }
      const heading = (text: string) => {
        ensure(12); doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
        doc.setTextColor(DARK[0], DARK[1], DARK[2]); doc.text(text, M, y); y += 7
      }

      y = cabeceraReporte(doc, {
        titulo:    'Reportes de personal',
        izquierda: empresaNombre,
        derecha:   `Año ${anio}`,
      })

      heading('Resumen')
      row('Plantilla activa', String(plantilla))
      row(`Altas en ${anio}`, String(altas))
      row(`Bajas en ${anio}`, String(bajas))
      for (const c of costeAnual) row(`Coste de personal (${c.moneda})`, formatMonto(c.monto), { bold: true, color: TEAL })

      y += 2; heading(`Coste de personal por mes · ${anio}`)
      if (costePorMes.length === 0) row('Sin nóminas confirmadas en el período.', '', { color: GRAY })
      for (const r of costePorMes) row(formatMes(r.periodo), lineaMoneda(r.monedas))

      y += 2; heading('Plantilla por departamento')
      for (const d of porDepto) row(`${d.departamento} (${d.activos})`, lineaMoneda(d.coste))

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
    rows.push('Reportes de personal')
    rows.push(`Empresa;${empresaNombre}`)
    rows.push(`Año;${anio}`)
    rows.push('')
    rows.push('RESUMEN')
    rows.push(`Plantilla activa;${plantilla}`)
    rows.push(`Altas;${altas}`)
    rows.push(`Bajas;${bajas}`)
    for (const c of costeAnual) rows.push(`Coste de personal (${c.moneda});${num(c.monto)}`)
    rows.push('')
    rows.push('COSTE POR MES')
    rows.push('Mes;Moneda;Importe')
    for (const r of costePorMes) for (const m of r.monedas) rows.push(`${formatMes(r.periodo)};${m.moneda};${num(m.monto)}`)
    rows.push('')
    rows.push('POR DEPARTAMENTO')
    rows.push('Departamento;Activos;Moneda;Coste')
    for (const d of porDepto) {
      if (d.coste.length === 0) rows.push(`${d.departamento};${d.activos};;`)
      for (const m of d.coste) rows.push(`${d.departamento};${d.activos};${m.moneda};${num(m.monto)}`)
    }
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `${nombreArchivo}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reportes de personal</h1>
          <p className="page-subtitle">Plantilla, altas y bajas, y coste de personal por período.</p>
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

      <div className="ter-toolbar">
        <EmpresaPills
          empresas={empresasFiltro}
          value={filtroEmpresa}
          onChange={setFiltroEmpresa}
          todasLabel="Todas"
        />
        <select className="input ter-filter-select" value={anio} onChange={e => setAnio(e.target.value)}>
          {anios.map(a => <option key={a} value={a}>Año {a}</option>)}
        </select>
      </div>

      {sinDatos ? (
        <div className="card card-table">
          <div className="mon-empty">
            <BarChart3 size={40} strokeWidth={1} opacity={0.2} />
            <p>Aún no hay datos. Da de alta personal y confirma nóminas para ver aquí la plantilla y el coste de personal.</p>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="gc-stats">
            <div className="gc-stat-card">
              <div className="gc-stat-label">Plantilla activa</div>
              <div className="rrhh-kpi-value">{plantilla}</div>
            </div>
            <div className="gc-stat-card">
              <div className="gc-stat-label">Altas en {anio}</div>
              <div className="rrhh-kpi-value">{altas}</div>
            </div>
            <div className="gc-stat-card">
              <div className="gc-stat-label">Bajas en {anio}</div>
              <div className="rrhh-kpi-value">{bajas}</div>
            </div>
            <div className="gc-stat-card gc-stat-pagar">
              <div className="gc-stat-label">Coste de personal {anio}</div>
              {costeAnual.length === 0
                ? <div className="gc-stat-empty">Sin nóminas confirmadas</div>
                : costeAnual.map(c => (
                    <div key={c.moneda} className="gc-stat-line"><span>{c.moneda}</span><strong>{formatMonto(c.monto)}</strong></div>
                  ))}
            </div>
          </div>

          <div className="info-box">
            <span className="text-xs-muted">El coste de personal son las nóminas <strong>confirmadas</strong> del período; coincide con los gastos de categoría <strong>«Salarios»</strong> de Reportes financieros (Tesorería refleja lo realmente pagado).</span>
          </div>

          {/* Desglose por empresa (vista consolidada) */}
          {porEmpresa.length > 0 && (
            <div className="card card-table rrhh-card-gap">
              <div className="ter-card-head"><span className="ter-form-section-title">Plantilla y coste por empresa · {anio}</span></div>
              <div className="table-wrapper">
                <table className="table">
                  <thead><tr><th>Empresa</th><th>Activos</th><th className="col-num">Coste {anio}</th></tr></thead>
                  <tbody>
                    {porEmpresa.map(e => (
                      <tr key={e.empresa_id}>
                        <td data-label="Empresa"><EmpresaTag color={colorOf(e.empresa_id)} nombre={e.nombre} /></td>
                        <td data-label="Activos" className="text-sm-muted">{e.activos}</td>
                        <td data-label={`Coste ${anio}`} className="col-num tes-monto-cell">
                          {e.coste.length === 0 ? '—' : e.coste.map(m => `${formatMonto(m.monto)} ${m.moneda}`).join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Coste por mes */}
          <div className="card card-table rrhh-card-gap">
            <div className="ter-card-head"><span className="ter-form-section-title">Coste de personal por mes · {anio}</span></div>
            {costePorMes.length === 0 ? (
              <div className="mon-empty"><BarChart3 size={32} strokeWidth={1} opacity={0.2} /><p>Sin nóminas confirmadas en {anio}.</p></div>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead><tr><th>Mes</th><th className="col-num">Coste</th></tr></thead>
                  <tbody>
                    {costePorMes.map(r => (
                      <tr key={r.periodo}>
                        <td data-label="Mes"><strong>{formatMes(r.periodo)}</strong></td>
                        <td data-label="Coste" className="col-num tes-monto-cell">
                          {r.monedas.map(m => `${formatMonto(m.monto)} ${m.moneda}`).join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Plantilla y coste por departamento */}
          <div className="card card-table">
            <div className="ter-card-head"><span className="ter-form-section-title">Plantilla por departamento</span></div>
            <div className="table-wrapper">
              <table className="table">
                <thead><tr><th>Departamento</th><th>Activos</th><th className="col-num">Coste {anio}</th></tr></thead>
                <tbody>
                  {porDepto.map(d => (
                    <tr key={d.departamento}>
                      <td data-label="Departamento"><strong>{d.departamento}</strong></td>
                      <td data-label="Activos" className="text-sm-muted">{d.activos}</td>
                      <td data-label={`Coste ${anio}`} className="col-num tes-monto-cell">
                        {d.coste.length === 0 ? '—' : d.coste.map(m => `${formatMonto(m.monto)} ${m.moneda}`).join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
