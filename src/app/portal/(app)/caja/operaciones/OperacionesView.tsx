'use client'

import { useMemo, useState } from 'react'
import { Search, ReceiptText, Boxes } from 'lucide-react'
import type { Ticket, MovimientoStock } from '@/app/actions/portal/caja'
import { usePagination, TablePagination } from '@/components/TablePagination'

interface Props {
  data: { tickets: Ticket[]; stock: MovimientoStock[]; cajaNombres: Record<string, string> }
}

const money = (n: number) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty   = (n: number) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 3 })
const fecha = (s: string) => s ? new Date(s).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—'

function estadoBadge(estado: string) {
  if (estado === 'ANULADO')       return <span className="mon-badge mon-badge-warn">Anulada</span>
  if (estado === 'RECTIFICACION') return <span className="mon-badge mon-badge-info">Rectificación</span>
  return <span className="mon-badge mon-badge-neutral">Original</span>
}

export default function OperacionesView({ data }: Props) {
  const [tab, setTab]       = useState<'ventas' | 'stock'>('ventas')
  const [search, setSearch] = useState('')
  const cajaNombre = (id: string) => data.cajaNombres[id] ?? id

  const ventas = useMemo(() => {
    const q = search.toLowerCase().trim()
    return data.tickets.filter(t =>
      !q || [cajaNombre(t.caja_id), t.moneda, t.medio_pago].filter(Boolean).join(' ').toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tickets, search])

  const stock = useMemo(() => {
    const q = search.toLowerCase().trim()
    return data.stock.filter(l =>
      !q || [cajaNombre(l.caja_id), l.descripcion].filter(Boolean).join(' ').toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.stock, search])

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Operaciones</h1>
          <p className="page-subtitle">Detalle de las ventas sincronizadas desde tus cajas, una a una.</p>
        </div>
      </div>

      <div className="caja-tabs">
        <button className={`caja-tab${tab === 'ventas' ? ' active' : ''}`} onClick={() => setTab('ventas')}>
          Ventas
        </button>
        <button className={`caja-tab${tab === 'stock' ? ' active' : ''}`} onClick={() => setTab('stock')}>
          Movimientos de stock
        </button>
      </div>

      <div className="ter-toolbar">
        <div className="ter-search-wrap">
          <Search size={16} strokeWidth={2} />
          <input type="search" className="ter-search" placeholder="Buscar por caja, producto…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {tab === 'ventas'
        ? <VentasTabla items={ventas} cajaNombre={cajaNombre} />
        : <StockTabla  items={stock}  cajaNombre={cajaNombre} />}
    </div>
  )
}

function VentasTabla({ items, cajaNombre }: { items: Ticket[]; cajaNombre: (id: string) => string }) {
  const { pageItems, ...pag } = usePagination(items)
  return (
    <div className="card card-table">
      {items.length === 0 ? (
        <div className="mon-empty">
          <ReceiptText size={36} strokeWidth={1} opacity={0.25} />
          <p>Sin ventas sincronizadas todavía.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th><th>Caja</th><th>Medio de pago</th>
                <th className="col-num">Total</th><th>Moneda</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(t => (
                <tr key={t.ticket_uuid}>
                  <td data-label="Fecha">{fecha(t.fecha)}</td>
                  <td data-label="Caja">{cajaNombre(t.caja_id)}</td>
                  <td data-label="Medio de pago">{t.medio_pago ?? '—'}</td>
                  <td data-label="Total" className="col-num">{money(t.total)}</td>
                  <td data-label="Moneda">{t.moneda}</td>
                  <td data-label="Estado">{estadoBadge(t.estado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TablePagination {...pag} label="venta" />
    </div>
  )
}

function StockTabla({ items, cajaNombre }: { items: MovimientoStock[]; cajaNombre: (id: string) => string }) {
  const { pageItems, ...pag } = usePagination(items)
  return (
    <div className="card card-table">
      {items.length === 0 ? (
        <div className="mon-empty">
          <Boxes size={36} strokeWidth={1} opacity={0.25} />
          <p>Sin movimientos de stock. Aparecen aquí las líneas de cada venta.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th><th>Caja</th><th>Producto</th>
                <th className="col-num">Cantidad</th><th className="col-num">Precio</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((l, i) => (
                <tr key={`${l.ticket_uuid}-${i}`}>
                  <td data-label="Fecha">{fecha(l.fecha)}</td>
                  <td data-label="Caja">{cajaNombre(l.caja_id)}</td>
                  <td data-label="Producto" className="cell-truncate">{l.descripcion}</td>
                  <td data-label="Cantidad" className="col-num">{qty(l.cantidad)}</td>
                  <td data-label="Precio" className="col-num">{money(l.precio_unitario)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TablePagination {...pag} label="movimiento" />
    </div>
  )
}
