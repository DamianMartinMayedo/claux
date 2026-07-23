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
          <p className="page-subtitle">Cierres de caja de tus puntos de venta, con el resumen de cada día.</p>
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
                  <th>Punto de venta</th><th>Abierta</th><th>Cerrada</th><th>Totales</th>
                  <th>Contabilidad</th><th>Inventario</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(c => (
                  <tr key={c.sesion_uuid}>
                    <td data-label="Punto de venta">{cajaNombre(c.caja_id)}</td>
                    <td data-label="Abierta">{fecha(c.abierta_at)}</td>
                    <td data-label="Cerrada">{fecha(c.cerrada_at)}</td>
                    <td data-label="Totales">{totales(c.total_por_moneda)}</td>
                    <td data-label="Contabilidad">
                      {(() => {
                        // No basta con que `tesoreria_movs` exista: `{}` es truthy, así
                        // que un cierre sin NADA posteado salía «Registrado» en verde.
                        // Registrado = todas las monedas vendidas tienen su ingreso.
                        const vendidas = Object.keys(c.total_por_moneda ?? {})
                        const hechas   = Object.keys(c.tesoreria_movs ?? {})
                        const faltan   = vendidas.filter(m => !hechas.includes(m))
                        if (vendidas.length > 0 && faltan.length === 0) {
                          return <span className="badge badge-success">Registrado</span>
                        }
                        if (hechas.length > 0) {
                          return (
                            <span className="badge badge-warning" title={`Falta: ${faltan.join(', ')}`}>
                              Falta {faltan.join(', ')}
                            </span>
                          )
                        }
                        return <span className="badge">Pendiente</span>
                      })()}
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
