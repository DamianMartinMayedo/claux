'use client'

import { Lock } from 'lucide-react'
import type { Cierre } from '@/app/actions/portal/caja'
import { usePagination, TablePagination } from '@/components/TablePagination'

const money = (n: number) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fecha = (s: string | null) => s ? new Date(s).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—'
function totales(t: Record<string, number>): string {
  const e = Object.entries(t ?? {})
  return e.length ? e.map(([m, v]) => `${money(v)} ${m}`).join(' · ') : '—'
}

export default function CierresView({ data }: { data: { cierres: Cierre[]; cajaNombres: Record<string, string> } }) {
  const { pageItems, ...pag } = usePagination(data.cierres)
  const cajaNombre = (id: string) => data.cajaNombres[id] ?? id

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cierres</h1>
          <p className="page-subtitle">Arqueos (Z) de tus cajas. Cada cierre genera el resumen a Tesorería e Inventario.</p>
        </div>
      </div>

      <div className="card card-table">
        {data.cierres.length === 0 ? (
          <div className="mon-empty">
            <Lock size={36} strokeWidth={1} opacity={0.25} />
            <p>Sin cierres sincronizados todavía.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Caja</th><th>Abierta</th><th>Cerrada</th><th>Totales</th>
                  <th>Contabilidad</th><th>Inventario</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(c => (
                  <tr key={c.sesion_uuid}>
                    <td data-label="Caja">{cajaNombre(c.caja_id)}</td>
                    <td data-label="Abierta">{fecha(c.abierta_at)}</td>
                    <td data-label="Cerrada">{fecha(c.cerrada_at)}</td>
                    <td data-label="Totales">{totales(c.total_por_moneda)}</td>
                    <td data-label="Contabilidad">
                      <span className={`badge ${c.tesoreria_movs ? 'badge-success' : ''}`}>
                        {c.tesoreria_movs ? 'Registrado' : 'Pendiente'}
                      </span>
                    </td>
                    <td data-label="Inventario">
                      <span className={`badge ${c.stock_movs ? 'badge-success' : ''}`}>
                        {c.stock_movs ? 'Descontado' : 'Pendiente'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="cierre" />
      </div>
    </div>
  )
}
