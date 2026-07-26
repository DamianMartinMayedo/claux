import Link from 'next/link'
import { Handshake } from 'lucide-react'
import type { ServiciosResumen } from '@/app/actions/portal/dashboard'
import { formatMoneda, formatFecha } from './format'

export default function ServiciosWidget({ data }: { data: ServiciosResumen }) {
  return (
    <section className="card dash-card-sm">
      <div className="card-header">
        <div className="dash-card-head">
          <span className="dash-card-icon metric-icon-success"><Handshake size={18} /></span>
          <h2 className="card-title">Servicios</h2>
        </div>
        <Link href="/portal/suscripciones" className="btn btn-secondary btn-sm">Ver suscripciones</Link>
      </div>

      <div className="dash-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">Suscripciones activas</span>
          <span className="dash-kpi-value">{data.activas}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Renuevan (30 días)</span>
          <span className="dash-kpi-value">{data.proximasRenovaciones}</span>
        </div>
      </div>

      {/* Con NOMBRE: «2 renuevan» no dice a quién hay que cobrar, que es lo único
          que se puede hacer con ese dato. */}
      {data.proximas.length > 0 ? (
        <ul className="dash-list">
          {data.proximas.map((p, i) => (
            <li key={i} className="dash-list-item">
              <span className="dash-list-main">
                <span className="dash-list-title">{p.nombre}</span>
                <span className="dash-list-meta">Renueva el {formatFecha(p.fecha)}</span>
              </span>
              <span className="dash-list-amount">{formatMoneda(p.importe, p.moneda)}</span>
            </li>
          ))}
        </ul>
      ) : data.ingresoRecurrente.length > 0 ? (
        <p className="dash-muted">
          Ingreso recurrente/mes:{' '}
          {data.ingresoRecurrente.map(r => formatMoneda(r.total, r.moneda)).join(' · ')}
        </p>
      ) : null}
    </section>
  )
}
