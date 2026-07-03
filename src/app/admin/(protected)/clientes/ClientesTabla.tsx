'use client'

import { Download, Search, User } from 'lucide-react'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { suscripcionLabel } from '@/lib/billing'
import { usePagination, TablePagination } from '@/components/TablePagination'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  DESACTIVADO: 'badge-warning', VENCIDO: 'badge-error',
}

type Cliente = {
  client_id: string; nombre_empresa: string; nombre_contacto: string | null
  email_admin: string; estado: string
  precio_mensual_usd: number | null; ciclo_facturacion: string | null
  fecha_expiracion: string | null; fecha_inicio: string | null
  fecha_fin_gracia: string | null
  created_at: string | null; notas: string | null
}

function cicloLabel(ciclo: string | null) {
  return ciclo === 'anual' ? 'Anual' : 'Mensual'
}

function formatFecha(fecha: string | null) {
  if (!fecha) return '—'
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

type DiasInfo = { label: string; variant: 'error' | 'warning' | 'success' | 'muted' }

function calcDiasRestantes(fechaExp: string | null, estado: string, fechaFinGracia: string | null = null): DiasInfo {
  if (estado === 'DESACTIVADO') return { label: '—', variant: 'muted' }
  
  // Para clientes en GRACIA, usar fecha_fin_gracia si existe
  const fechaCalcular = (estado === 'GRACIA' && fechaFinGracia) ? fechaFinGracia : fechaExp
  if (!fechaCalcular)    return { label: '—', variant: 'muted' }

  const [y, m, d] = fechaCalcular.split('T')[0].split('-').map(Number)
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

function exportCSV(clientes: Cliente[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const headers = ['ID Cliente', 'Empresa', 'Contacto', 'Email', 'Precio mensual USD', 'Ciclo',
    'Estado', 'Expiración', 'Días restantes', 'Fecha alta', 'Notas']
  const rows = clientes.map(c => [
    c.client_id, c.nombre_empresa, c.nombre_contacto ?? '', c.email_admin,
    Number(c.precio_mensual_usd ?? 0).toFixed(2), cicloLabel(c.ciclo_facturacion), c.estado,
    c.fecha_expiracion ?? '', calcDiasRestantes(c.fecha_expiracion, c.estado, c.fecha_fin_gracia).label,
    c.fecha_inicio ?? c.created_at ?? '', c.notas ?? '',
  ])
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
  const blob = new Blob(['' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'clientes.csv'; a.click()
  URL.revokeObjectURL(url)
}

export default function ClientesTabla({
  clientes,
  descuentoAnualPct,
}: {
  clientes: Cliente[]
  descuentoAnualPct: number
}) {
  const router = useRouter()
  const [busqueda, setBusqueda]         = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase()
    return clientes.filter(c => {
      const coincideBusqueda = !q ||
        c.nombre_empresa.toLowerCase().includes(q) ||
        c.email_admin.toLowerCase().includes(q) ||
        c.client_id.toLowerCase().includes(q)
      const coincideEstado = !filtroEstado || c.estado === filtroEstado
      return coincideBusqueda && coincideEstado
    })
  }, [clientes, busqueda, filtroEstado])

  const { pageItems, ...pag } = usePagination(filtrados)

  return (
    <>
      {/* Filtros */}
      <div className="filters-bar">
        <div className="search-wrapper">
          <Search />
          <input
            type="search" className="search-input"
            placeholder="Buscar por empresa, email o ID…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
        </div>

        <select className="filter-select" value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="ACTIVO">Activo</option>
          <option value="TRIAL">Trial</option>
          <option value="GRACIA">Período especial</option>
          <option value="DESACTIVADO">Suspendido</option>
          <option value="VENCIDO">Vencido</option>
        </select>

        <button className="btn btn-secondary" onClick={() => exportCSV(filtrados)}>
          <Download size={14} />
          Exportar CSV
        </button>
      </div>

      {filtrados.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <User size={40} strokeWidth={1.5} />
            <p>No se encontraron clientes con los filtros aplicados.</p>
          </div>
        </div>
      ) : (
        <>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Email</th>
                <th>Suscripción</th>
                <th>Estado</th>
                <th>Expiración</th>
                <th className="col-center">Días</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(c => {
                const dias = calcDiasRestantes(c.fecha_expiracion, c.estado, c.fecha_fin_gracia)
                return (
                  <tr key={c.client_id} className="table-row-clickable" onClick={() => router.push(`/admin/clientes/${c.client_id}`)}>
                    <td data-label="Empresa">
                      <Link
                        href={`/admin/clientes/${c.client_id}`}
                        className="table-empresa-link"
                        onClick={e => e.stopPropagation()}
                      >
                        {c.nombre_empresa}
                      </Link>
                      <div className="table-empresa-contact">{c.client_id}</div>
                    </td>
                    <td data-label="Email" className="table-muted">{c.email_admin}</td>
                    <td data-label="Suscripción" className="table-muted">
                      {suscripcionLabel(Number(c.precio_mensual_usd ?? 0), c.ciclo_facturacion ?? 'mensual', descuentoAnualPct)}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge badge-dot ${ESTADO_BADGE[c.estado] ?? 'badge-neutral'}`}>
                        {c.estado}
                      </span>
                    </td>
                    <td data-label="Expiración" className="table-muted">{formatFecha(c.fecha_expiracion)}</td>
                    <td data-label="Días" className="col-center">
                      <span className="dias-value" style={{ color: DIAS_COLOR[dias.variant] }}>
                        {dias.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <TablePagination {...pag} label="cliente" />
        </>
      )}
    </>
  )
}
