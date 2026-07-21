import Link from 'next/link'
import { Handshake } from 'lucide-react'
import type { ServiciosResumen } from '@/app/actions/portal/dashboard'

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

      {data.ingresoRecurrente.length > 0 && (
        <p className="dash-muted">
          Ingreso recurrente/mes:{' '}
          {data.ingresoRecurrente
            .map(r => `${r.total.toLocaleString('es-ES', { minimumFractionDigits: 2 })} ${r.moneda}`)
            .join(' · ')}
        </p>
      )}
    </section>
  )
}
