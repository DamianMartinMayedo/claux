'use client'

import { useState, useMemo }            from 'react'
import { useRouter }                    from 'next/navigation'
import { Plus, ShoppingCart }           from 'lucide-react'
import {
  type ComprasPageData,
  type EstadoCompra,
} from '@/app/actions/portal/compras'
import { CompraFormModal }              from './_CompraFormModal'

function fmt(n: number, moneda: string) {
  return new Intl.NumberFormat('es-VE', {
    style: 'currency', currency: moneda, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ESTADO_BADGE: Record<EstadoCompra, string> = {
  BORRADOR: 'badge-neutral', CONFIRMADA: 'badge-success', ANULADA: 'badge-error',
}
const ESTADO_LABEL: Record<EstadoCompra, string> = {
  BORRADOR: 'Borrador', CONFIRMADA: 'Confirmada', ANULADA: 'Anulada',
}

export default function ComprasView({ data }: { data: ComprasPageData }) {
  const router = useRouter()
  const [modalOpen,    setModalOpen]    = useState(false)
  const [filtroEstado, setFiltroEstado] = useState('')

  const filtradas = useMemo(
    () => data.compras.filter(c => !filtroEstado || c.estado === filtroEstado),
    [data.compras, filtroEstado],
  )

  const sinAlmacenes = data.almacenes.length === 0

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Compras</h1>
          <p className="page-subtitle">Compras a proveedores. Al confirmar suben el stock y generan un gasto en Cuentas por pagar.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)} disabled={sinAlmacenes}>
          <Plus size={14} strokeWidth={2.5} /> Nueva compra
        </button>
      </div>

      {sinAlmacenes && (
        <div className="alm-nota-info">
          <strong className="text-muted">Necesitas un almacén</strong> para registrar compras. Crea uno en{' '}
          <strong className="text-muted">Almacenes</strong>.
        </div>
      )}

      <div className="ter-toolbar">
        <select className="input ter-filter-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="BORRADOR">Borrador</option>
          <option value="CONFIRMADA">Confirmada</option>
          <option value="ANULADA">Anulada</option>
        </select>
      </div>

      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">Compras</h2>
          <span className="text-xs-muted">{filtradas.length} de {data.compras.length}</span>
        </div>

        {filtradas.length === 0 ? (
          <div className="mon-empty">
            <ShoppingCart size={40} strokeWidth={1} opacity={0.2} />
            <p>
              {data.compras.length === 0
                ? 'Aún no hay compras registradas. Crea la primera para reponer stock.'
                : 'No hay compras con ese estado.'}
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Fecha</th>
                  <th>Proveedor</th>
                  <th>Almacén</th>
                  <th>Estado</th>
                  <th className="col-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map(c => (
                  <tr key={c.compra_id} className="table-row-clickable"
                    onClick={() => router.push(`/portal/compras/${c.compra_id}`)}>
                    <td data-label="Número"><code className="text-mono">{c.numero}</code></td>
                    <td data-label="Fecha" className="text-sm-muted">{fmtDate(c.fecha)}</td>
                    <td data-label="Proveedor">{c.proveedor_id ? (data.proveedor_nombres[c.proveedor_id] ?? c.proveedor_id) : <span className="text-faint">—</span>}</td>
                    <td data-label="Almacén" className="text-sm-muted">{data.almacen_nombres[c.almacen_id] ?? c.almacen_id}</td>
                    <td data-label="Estado"><span className={`badge ${ESTADO_BADGE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span></td>
                    <td data-label="Total" className="col-num">{fmt(c.total, c.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <CompraFormModal
          form={{
            proveedores: data.proveedores,
            almacenes:   data.almacenes,
            productos:   data.productos,
            monedas:     data.monedas,
          }}
          onClose={() => setModalOpen(false)}
          onSaved={(compra_id) => router.push(`/portal/compras/${compra_id}`)}
        />
      )}
    </div>
  )
}
