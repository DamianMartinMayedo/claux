import Link from 'next/link'
import { Handshake } from 'lucide-react'
import type { ServiciosResumen } from '@/app/actions/portal/dashboard'
import { formatMoneda, formatFecha } from './format'

export default function ServiciosWidget({ data }: { data: ServiciosResumen }) {
  return (
    <section className="card dash-card-sm">
      <div className="card-header">
        <div className="dash-card-head">
          <span className="dash-card-icon metric-icon-primary"><Handshake size={18} /></span>
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

      {/* El ingreso recurrente no dice si SUBE o BAJA, que es la pregunta de quien vive
          de cuotas. Solo se pinta si hubo movimiento este mes: un «0 altas · 0 bajas»
          fijo es una línea que nunca aporta. */}
      {(data.altasMes > 0 || data.bajasMes > 0) && (
        <p className="dash-muted">
          Este mes: {data.altasMes} alta{data.altasMes === 1 ? '' : 's'} ·{' '}
          {data.bajasMes} baja{data.bajasMes === 1 ? '' : 's'}
          {' '}({data.altasMes - data.bajasMes >= 0 ? '+' : ''}{data.altasMes - data.bajasMes} neto)
        </p>
      )}

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
