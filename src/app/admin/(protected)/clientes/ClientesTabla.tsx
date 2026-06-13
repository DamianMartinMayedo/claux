'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  SUSPENDIDO: 'badge-warning', VENCIDO: 'badge-error',
}

type Cliente = {
  client_id: string; nombre_empresa: string; nombre_contacto: string | null
  email_admin: string; plan_id: string; estado: string
  fecha_expiracion: string | null; fecha_inicio: string | null
  created_at: string | null; notas: string | null
}

type Plan = { plan_id: string; nombre: string }

const POR_PAGINA = 10

function formatFecha(fecha: string | null) {
  if (!fecha) return '—'
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

type DiasInfo = { label: string; variant: 'error' | 'warning' | 'success' | 'muted' }

function calcDiasRestantes(fechaExp: string | null, estado: string): DiasInfo {
  if (estado === 'SUSPENDIDO') return { label: '—', variant: 'muted' }
  if (!fechaExp)               return { label: '—', variant: 'muted' }

  const [y, m, d] = fechaExp.split('T')[0].split('-').map(Number)
  const exp = new Date(y, m - 1, d)
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const dias = Math.ceil((exp.getTime() - hoy.getTime()) / 86_400_000)

  if (dias < 0)   return { label: 'Vencido',   variant: 'error' }
  if (dias === 0) return { label: 'Hoy',        variant: 'error' }
  if (dias <= 5)  return { label: `${dias}d`,   variant: 'error' }
  if (dias <= 14) return { label: `${dias}d`,   variant: 'warning' }
  return              { label: `${dias}d`,       variant: 'success' }
}

const DIAS_COLOR: Record<DiasInfo['variant'], string> = {
  error:   'var(--color-error)',
  warning: 'var(--color-warning)',
  success: 'var(--color-success)',
  muted:   'var(--color-text-muted)',
}

function exportCSV(clientes: Cliente[], planNombre: Record<string, string>) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const headers = ['ID Cliente', 'Empresa', 'Contacto', 'Email', 'Plan ID', 'Plan',
    'Estado', 'Expiración', 'Días restantes', 'Fecha alta', 'Notas']
  const rows = clientes.map(c => [
    c.client_id, c.nombre_empresa, c.nombre_contacto ?? '', c.email_admin,
    c.plan_id, planNombre[c.plan_id] ?? '', c.estado,
    c.fecha_expiracion ?? '', calcDiasRestantes(c.fecha_expiracion, c.estado).label,
    c.fecha_inicio ?? c.created_at ?? '', c.notas ?? '',
  ])
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'clientes.csv'; a.click()
  URL.revokeObjectURL(url)
}

export default function ClientesTabla({
  clientes,
  planes,
  planNombre,
}: {
  clientes: Cliente[]
  planes: Plan[]
  planNombre: Record<string, string>
}) {
  const router = useRouter()
  const [busqueda, setBusqueda]         = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroPlan, setFiltroPlan]     = useState('')
  const [pagina, setPagina]             = useState(1)

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase()
    return clientes.filter(c => {
      const coincideBusqueda = !q ||
        c.nombre_empresa.toLowerCase().includes(q) ||
        c.email_admin.toLowerCase().includes(q) ||
        c.client_id.toLowerCase().includes(q)
      const coincideEstado = !filtroEstado || c.estado === filtroEstado
      const coincidePlan   = !filtroPlan   || c.plan_id === filtroPlan
      return coincideBusqueda && coincideEstado && coincidePlan
    })
  }, [clientes, busqueda, filtroEstado, filtroPlan])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const paginados = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)

  function resetPagina(fn: () => void) { fn(); setPagina(1) }

  return (
    <>
      {/* Filtros */}
      <div className="filters-bar">
        <div className="search-wrapper">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search" className="search-input"
            placeholder="Buscar por empresa, email o ID…"
            value={busqueda}
            onChange={e => resetPagina(() => setBusqueda(e.target.value))}
          />
        </div>

        <select className="filter-select" value={filtroEstado}
          onChange={e => resetPagina(() => setFiltroEstado(e.target.value))}>
          <option value="">Todos los estados</option>
          <option value="ACTIVO">Activo</option>
          <option value="TRIAL">Trial</option>
          <option value="GRACIA">Período especial</option>
          <option value="SUSPENDIDO">Suspendido</option>
          <option value="VENCIDO">Vencido</option>
        </select>

        <select className="filter-select" value={filtroPlan}
          onChange={e => resetPagina(() => setFiltroPlan(e.target.value))}>
          <option value="">Todos los planes</option>
          {planes.map(p => (
            <option key={p.plan_id} value={p.plan_id}>{p.nombre}</option>
          ))}
        </select>

        <button className="btn btn-secondary" onClick={() => exportCSV(filtrados, planNombre)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Exportar CSV
        </button>
      </div>

      {filtrados.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
            </svg>
            <p>No se encontraron clientes con los filtros aplicados.</p>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Email</th>
                <th>Plan</th>
                <th>Estado</th>
                <th>Expiración</th>
                <th className="text-center">Días</th>
              </tr>
            </thead>
            <tbody>
              {paginados.map(c => {
                const dias = calcDiasRestantes(c.fecha_expiracion, c.estado)
                return (
                  <tr key={c.client_id} className="table-row-clickable" onClick={() => router.push(`/admin/clientes/${c.client_id}`)}>
                    <td>
                      <Link
                        href={`/admin/clientes/${c.client_id}`}
                        className="table-empresa-link"
                        onClick={e => e.stopPropagation()}
                      >
                        {c.nombre_empresa}
                      </Link>
                      <div className="table-empresa-contact">{c.client_id}</div>
                    </td>
                    <td className="table-muted">{c.email_admin}</td>
                    <td className="table-muted">{planNombre[c.plan_id] ?? c.plan_id ?? '—'}</td>
                    <td>
                      <span className={`badge badge-dot ${ESTADO_BADGE[c.estado] ?? 'badge-neutral'}`}>
                        {c.estado}
                      </span>
                    </td>
                    <td className="table-muted">{formatFecha(c.fecha_expiracion)}</td>
                    <td className="text-center">
                      <span className="dias-value" style={{ color: DIAS_COLOR[dias.variant] }}>
                        {dias.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {totalPaginas > 1 && (
            <div className="pagination">
              <span>{filtrados.length} cliente{filtrados.length !== 1 ? 's' : ''} · Página {pagina} de {totalPaginas}</span>
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
