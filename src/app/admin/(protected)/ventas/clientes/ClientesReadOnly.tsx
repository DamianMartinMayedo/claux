'use client'

import { Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { suscripcionLabel } from '@/lib/billing'
import { usePagination, TablePagination } from '@/components/TablePagination'
import VentasTabs from '@/components/admin/VentasTabs'
import type { RolAdmin, SeccionKey } from '@/lib/roles'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  DESACTIVADO: 'badge-warning', VENCIDO: 'badge-error',
}

export type ClienteRO = {
  client_id: string
  nombre_empresa: string
  nombre_contacto: string | null
  email_admin: string
  estado: string
  precio_mensual_usd: number | null
  ciclo_facturacion: string | null
}

export default function ClientesReadOnly({
  clientes,
  descuentoAnualPct,
  rol,
  permisos,
}: {
  clientes: ClienteRO[]
  descuentoAnualPct: number
  rol: RolAdmin
  permisos: SeccionKey[]
}) {
  const [busqueda, setBusqueda] = useState('')

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase()
    if (!q) return clientes
    return clientes.filter(c =>
      c.nombre_empresa.toLowerCase().includes(q) ||
      c.email_admin.toLowerCase().includes(q) ||
      c.client_id.toLowerCase().includes(q) ||
      (c.nombre_contacto ?? '').toLowerCase().includes(q),
    )
  }, [clientes, busqueda])

  const { pageItems, ...pag } = usePagination(filtrados)

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">{clientes.length} en total · vista de solo lectura.</p>
        </div>
      </div>

      <VentasTabs rol={rol} permisos={permisos} />

      <div className="filters-bar">
        <div className="search-wrapper">
          <Search />
          <input
            type="search" className="search-input"
            placeholder="Buscar por empresa, contacto, email o ID…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="table-wrapper">
          <div className="table-empty">
            <Users size={40} strokeWidth={1.5} />
            <p>No se encontraron clientes.</p>
          </div>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Contacto</th>
                  <th>Email</th>
                  <th>Suscripción</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(c => (
                  <tr key={c.client_id}>
                    <td data-label="Empresa">
                      <div className="table-empresa">{c.nombre_empresa}</div>
                      <div className="table-empresa-contact">{c.client_id}</div>
                    </td>
                    <td data-label="Contacto" className="table-muted">{c.nombre_contacto || '—'}</td>
                    <td data-label="Email" className="table-muted">{c.email_admin}</td>
                    <td data-label="Suscripción" className="table-muted">
                      {suscripcionLabel(Number(c.precio_mensual_usd ?? 0), c.ciclo_facturacion ?? 'mensual', descuentoAnualPct)}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge badge-dot ${ESTADO_BADGE[c.estado] ?? 'badge-neutral'}`}>
                        {c.estado}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination {...pag} label="cliente" />
        </div>
      )}
    </div>
  )
}
