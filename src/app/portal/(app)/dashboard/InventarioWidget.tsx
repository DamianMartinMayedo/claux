import Link from 'next/link'
import { Boxes } from 'lucide-react'
import type { InventarioResumen } from '@/app/actions/portal/dashboard'

export default function InventarioWidget({ data }: { data: InventarioResumen }) {
  return (
    <section className="card dash-card-sm">
      <div className="card-header">
        <div className="dash-card-head">
          <span className="dash-card-icon metric-icon-amber"><Boxes size={18} /></span>
          <h2 className="card-title">Inventario</h2>
        </div>
        <Link href="/portal/inventario" className="btn btn-secondary btn-sm">Ver inventario</Link>
      </div>

      <div className="dash-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">Bajo mínimo</span>
          <span className={`dash-kpi-value ${data.bajoMinimoCount > 0 ? 'is-neg' : 'is-pos'}`}>{data.bajoMinimoCount}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Productos</span>
          <span className="dash-kpi-value">{data.totalProductos}</span>
        </div>
      </div>

      {data.bajoMinimo.length === 0 ? (
        <p className="dash-muted">Todo el stock está por encima del mínimo.</p>
      ) : (
        <ul className="dash-list">
          {data.bajoMinimo.map((p, i) => (
            <li key={i} className="dash-list-item">
              <span className="dash-list-main">
                <span className="dash-list-title">{p.nombre}</span>
                <span className="dash-list-meta">Mínimo {p.minimo} {p.unidad}</span>
              </span>
              <span className="dash-list-amount is-neg">{p.stock} {p.unidad}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
