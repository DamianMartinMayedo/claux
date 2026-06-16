'use client'

import { CreditCard, Download, Search } from 'lucide-react'
import { useState, useMemo } from 'react'
import EditarPagoModal  from './EditarPagoModal'
import EliminarPagoBtn  from './EliminarPagoBtn'
import ConfirmarPagoBtn from './ConfirmarPagoBtn'

const METODO_LABEL: Record<string, string> = {
  tropipay: 'TropiPay', transferencia: 'Transferencia', efectivo: 'Efectivo',
}

type Pago = {
  pago_id: string; client_id: string; concepto: string | null; estado: string | null
  monto_usd: number; metodo: string; fecha: string
  fecha_inicio_periodo: string | null; fecha_fin_periodo: string | null
  notas: string | null
}

const POR_PAGINA = 10

function conceptoLabel(concepto: string | null) {
  return concepto === 'configuracion' ? 'Configuración' : 'Suscripción'
}

function estadoLabel(estado: string | null) {
  return estado === 'por_confirmar' ? 'Por confirmar' : 'Confirmado'
}

function formatFecha(fecha: string | null) {
  if (!fecha) return '—'
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(y).slice(-2)}`
}

function exportCSV(
  pagos: Pago[],
  clienteNombre: Record<string, string>,
) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const headers = ['ID Pago', 'Cliente ID', 'Empresa', 'Concepto', 'Estado', 'Método',
    'Monto USD', 'Fecha', 'Inicio período', 'Fin período']
  const rows = pagos.map(p => [
    p.pago_id, p.client_id, clienteNombre[p.client_id] ?? '',
    conceptoLabel(p.concepto), estadoLabel(p.estado),
    METODO_LABEL[p.metodo] ?? p.metodo,
    p.monto_usd, p.fecha ?? '',
    p.fecha_inicio_periodo ?? '', p.fecha_fin_periodo ?? '',
  ])
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'pagos.csv'; a.click()
  URL.revokeObjectURL(url)
}

export default function PagosTabla({
  pagos,
  clienteNombre,
}: {
  pagos: Pago[]
  clienteNombre: Record<string, string>
}) {
  const [busqueda, setBusqueda]           = useState('')
  const [filtroConcepto, setFiltroConcepto] = useState('')
  const [filtroEstado, setFiltroEstado]   = useState('')
  const [filtroMetodo, setFiltroMetodo]   = useState('')
  const [pagina, setPagina]               = useState(1)

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase()
    return pagos.filter(p => {
      const nombre = (clienteNombre[p.client_id] ?? '').toLowerCase()
      const coincideBusqueda  = !q || nombre.includes(q) || p.client_id.toLowerCase().includes(q)
      const conceptoP = p.concepto === 'configuracion' ? 'configuracion' : 'suscripcion'
      const coincideConcepto  = !filtroConcepto || conceptoP === filtroConcepto
      const estadoP = p.estado === 'por_confirmar' ? 'por_confirmar' : 'confirmado'
      const coincideEstado    = !filtroEstado || estadoP === filtroEstado
      const coincideMetodo    = !filtroMetodo || p.metodo  === filtroMetodo
      return coincideBusqueda && coincideConcepto && coincideEstado && coincideMetodo
    })
  }, [pagos, busqueda, filtroConcepto, filtroEstado, filtroMetodo, clienteNombre])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const paginados = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)

  function resetPagina(fn: () => void) { fn(); setPagina(1) }

  return (
    <>
      {/* Filtros */}
      <div className="filters-bar">
        <div className="search-wrapper">
          <Search />
          <input
            type="search" className="search-input"
            placeholder="Buscar por empresa o ID cliente…"
            value={busqueda}
            onChange={e => resetPagina(() => setBusqueda(e.target.value))}
          />
        </div>

        <select className="filter-select" value={filtroConcepto}
          onChange={e => resetPagina(() => setFiltroConcepto(e.target.value))}>
          <option value="">Todos los conceptos</option>
          <option value="suscripcion">Suscripción</option>
          <option value="configuracion">Configuración</option>
        </select>

        <select className="filter-select" value={filtroEstado}
          onChange={e => resetPagina(() => setFiltroEstado(e.target.value))}>
          <option value="">Todos los estados</option>
          <option value="por_confirmar">Por confirmar</option>
          <option value="confirmado">Confirmado</option>
        </select>

        <select className="filter-select" value={filtroMetodo}
          onChange={e => resetPagina(() => setFiltroMetodo(e.target.value))}>
          <option value="">Todos los métodos</option>
          <option value="tropipay">TropiPay</option>
          <option value="transferencia">Transferencia</option>
          <option value="efectivo">Efectivo</option>
        </select>

        <button className="btn btn-secondary" onClick={() => exportCSV(filtrados, clienteNombre)}>
          <Download size={14} />
          Exportar CSV
        </button>
      </div>

      {filtrados.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <CreditCard size={40} strokeWidth={1.5} />
            <p>No se encontraron pagos con los filtros aplicados.</p>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Cliente</th>
                <th>Concepto</th>
                <th>Estado</th>
                <th>Método</th>
                <th>Monto USD</th>
                <th>Fecha</th>
                <th>Período</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paginados.map(p => (
                <tr key={p.pago_id}>
                  <td><span className="table-code-muted">{p.pago_id}</span></td>
                  <td>
                    <div className="table-empresa">{clienteNombre[p.client_id] ?? p.client_id}</div>
                    <div className="table-empresa-contact">{p.client_id}</div>
                  </td>
                  <td>
                    <span className={`badge ${p.concepto === 'configuracion' ? 'badge-info' : 'badge-neutral'}`}>
                      {conceptoLabel(p.concepto)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${p.estado === 'por_confirmar' ? 'badge-warning' : 'badge-success'}`}>
                      {estadoLabel(p.estado)}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-neutral">
                      {METODO_LABEL[p.metodo] ?? p.metodo}
                    </span>
                  </td>
                  <td className="table-price">${p.monto_usd?.toFixed(2)}</td>
                  <td className="table-muted">{formatFecha(p.fecha)}</td>
                  <td className="table-muted text-xs">
                    {p.fecha_inicio_periodo && p.fecha_fin_periodo
                      ? `${formatFecha(p.fecha_inicio_periodo)} → ${formatFecha(p.fecha_fin_periodo)}`
                      : '—'}
                  </td>
                  <td className="table-actions-right">
                    <div className="table-actions-group">
                      {p.estado === 'por_confirmar' && (
                        <ConfirmarPagoBtn
                          pagoId={p.pago_id}
                          clienteNombre={clienteNombre[p.client_id] ?? p.client_id}
                          monto={p.monto_usd}
                          concepto={p.concepto}
                        />
                      )}
                      <EditarPagoModal
                        pago={p}
                        clienteNombre={clienteNombre[p.client_id] ?? p.client_id}
                      />
                      <EliminarPagoBtn
                        pagoId={p.pago_id}
                        clienteNombre={clienteNombre[p.client_id] ?? p.client_id}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPaginas > 1 && (
            <div className="pagination">
              <span>{filtrados.length} pago{filtrados.length !== 1 ? 's' : ''} · Página {pagina} de {totalPaginas}</span>
              <div className="pagination-controls">
                <button className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}>‹ Ant.</button>
                <button className="btn btn-secondary btn-sm" disabled={pagina >= totalPaginas} onClick={() => setPagina(p => p + 1)}>Sig. ›</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
