'use client'

import { useMemo, useState } from 'react'
import { type RrhhPageData } from '@/app/actions/portal/rrhh'
import { BarChart3 } from 'lucide-react'

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

  const sinDatos = data.empleados.length === 0

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reportes de personal</h1>
          <p className="page-subtitle">Plantilla, altas y bajas, y coste de personal por período.</p>
        </div>
      </div>

      <div className="ter-toolbar">
        {data.empresas.length > 1 && (
          <select className="input ter-filter-select" value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)}>
            <option value="">Todas las empresas</option>
            {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
          </select>
        )}
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
