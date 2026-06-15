'use client'

import { useState, useTransition } from 'react'
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
    </div>
  )
}

function IconChart() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" opacity="0.2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
}
function IconSearch() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
}
