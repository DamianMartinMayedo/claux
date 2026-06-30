'use client'

import { useMemo, useState } from 'react'
import { type RrhhPageData } from '@/app/actions/portal/rrhh'
import { BarChart3, Download, ChevronDown } from 'lucide-react'
import { EmpresaTag }   from '@/components/portal/EmpresaTag'
import EmpresaPills     from '@/components/portal/EmpresaPills'
import { useEmpresas }  from '@/components/portal/EmpresaColorContext'

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
function formatMes(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m) return periodo
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function porMoneda(entries: { moneda: string; monto: number }[]): { moneda: string; monto: number }[] {
  const m = new Map<string, number>()
  for (const e of entries) m.set(e.moneda, (m.get(e.moneda) ?? 0) + e.monto)
  return Array.from(m.entries()).map(([moneda, monto]) => ({ moneda, monto })).sort((a, b) => a.moneda.localeCompare(b.moneda))
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

  // Años disponibles (de nóminas) + el actual
  const anios = useMemo(() => {
    const set = new Set<string>([anioActual])
    for (const n of data.nominas) if (n.periodo) set.add(n.periodo.slice(0, 4))
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [data.nominas, anioActual])

  // Empleado → departamento (para desgloses), sobre toda la plantilla
  const deptoDe = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of data.empleados) m.set(e.empleado_id, e.departamento || 'Sin departamento')
    return m
  }, [data.empleados])

  const empleados = useMemo(
    () => data.empleados.filter(e => !filtroEmpresa || e.empresa_id === filtroEmpresa),
    [data.empleados, filtroEmpresa],
  )
  const nominas = useMemo(
    () => data.nominas.filter(n =>
      (!filtroEmpresa || n.empresa_id === filtroEmpresa) &&
      n.estado === 'CONFIRMADA' &&
      n.periodo.startsWith(anio),
    ),
    [data.nominas, filtroEmpresa, anio],
  )

  const plantilla = empleados.filter(e => e.estado === 'ACTIVO').length
  const altas     = empleados.filter(e => e.fecha_alta?.slice(0, 4) === anio).length
  const bajas     = empleados.filter(e => e.fecha_baja && e.fecha_baja.slice(0, 4) === anio).length

  const costeAnual = useMemo(
    () => porMoneda(nominas.map(n => ({ moneda: n.moneda, monto: n.total }))),
    [nominas],
  )

  // Coste por mes (período → moneda → total)
  const costePorMes = useMemo(() => {
    const m = new Map<string, { moneda: string; monto: number }[]>()
    for (const n of nominas) {
      const arr = m.get(n.periodo) ?? []
      arr.push({ moneda: n.moneda, monto: n.total })
      m.set(n.periodo, arr)
    }
    return Array.from(m.entries())
      .map(([periodo, e]) => ({ periodo, monedas: porMoneda(e) }))
      .sort((a, b) => b.periodo.localeCompare(a.periodo))
  }, [nominas])

  // Plantilla y coste por departamento
  const porDepto = useMemo(() => {
    const headcount = new Map<string, number>()
    for (const e of empleados) {
      if (e.estado !== 'ACTIVO') continue
      const d = e.departamento || 'Sin departamento'
      headcount.set(d, (headcount.get(d) ?? 0) + 1)
    }
    const coste = new Map<string, { moneda: string; monto: number }[]>()
    for (const n of nominas) {
      for (const l of n.lineas) {
        const d = deptoDe.get(l.empleado_id) ?? 'Sin departamento'
        const arr = coste.get(d) ?? []
        arr.push({ moneda: n.moneda, monto: l.neto })
        coste.set(d, arr)
      }
    }
    const deptos = new Set<string>([...headcount.keys(), ...coste.keys()])
    return Array.from(deptos).sort().map(d => ({
      departamento: d,
      activos:      headcount.get(d) ?? 0,
      coste:        porMoneda(coste.get(d) ?? []),
    }))
  }, [empleados, nominas, deptoDe])

  // Desglose por empresa (solo en vista consolidada "Todas"): plantilla y coste
  // de cada empresa con su color. Usa los datos ya cargados en cliente.
  const porEmpresa = useMemo(() => {
    if (filtroEmpresa) return []
    return data.empresas
      .map(emp => ({
        empresa_id: emp.empresa_id,
        nombre:     emp.nombre,
        activos:    data.empleados.filter(e => e.empresa_id === emp.empresa_id && e.estado === 'ACTIVO').length,
        coste:      porMoneda(
          data.nominas
            .filter(n => n.empresa_id === emp.empresa_id && n.estado === 'CONFIRMADA' && n.periodo.startsWith(anio))
            .map(n => ({ moneda: n.moneda, monto: n.total })),
        ),
      }))
      .filter(e => e.activos > 0 || e.coste.length > 0)
  }, [data.empresas, data.empleados, data.nominas, filtroEmpresa, anio])

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
      const mod = await import('jspdf') as unknown as { jsPDF: new (o: object) => JsPdfDoc }
      const doc: JsPdfDoc = new mod.jsPDF({ unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()
      const M = 16, right = pageW - M
      let y = M
      const TEAL: [number, number, number] = [13, 148, 136]
      const DARK: [number, number, number] = [28, 27, 22]
      const GRAY: [number, number, number] = [107, 104, 98]

      const ensure = (s: number) => { if (y + s > pageH - M) { doc.addPage(); y = M } }
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

      doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
      doc.setTextColor(TEAL[0], TEAL[1], TEAL[2]); doc.text('CLAUX', M, y); y += 6
      doc.setFontSize(18); doc.setTextColor(DARK[0], DARK[1], DARK[2]); doc.text('Reportes de personal', M, y); y += 6
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(GRAY[0], GRAY[1], GRAY[2])
      doc.text(empresaNombre, M, y); doc.text(`Año ${anio}`, right, y, { align: 'right' }); y += 3
      doc.setDrawColor(DARK[0], DARK[1], DARK[2]); doc.line(M, y, right, y); y += 9

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
          todasLabel="Todas las empresas"
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
                  <thead><tr><th>Empresa</th><th>Activos</th><th className="tes-col-monto">Coste {anio}</th></tr></thead>
                  <tbody>
                    {porEmpresa.map(e => (
                      <tr key={e.empresa_id}>
                        <td><EmpresaTag color={colorOf(e.empresa_id)} nombre={e.nombre} /></td>
                        <td className="text-sm-muted">{e.activos}</td>
                        <td className="tes-col-monto tes-monto-cell">
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
                  <thead><tr><th>Mes</th><th className="tes-col-monto">Coste</th></tr></thead>
                  <tbody>
                    {costePorMes.map(r => (
                      <tr key={r.periodo}>
                        <td><strong>{formatMes(r.periodo)}</strong></td>
                        <td className="tes-col-monto tes-monto-cell">
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
                <thead><tr><th>Departamento</th><th>Activos</th><th className="tes-col-monto">Coste {anio}</th></tr></thead>
                <tbody>
                  {porDepto.map(d => (
                    <tr key={d.departamento}>
                      <td><strong>{d.departamento}</strong></td>
                      <td className="text-sm-muted">{d.activos}</td>
                      <td className="tes-col-monto tes-monto-cell">
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
