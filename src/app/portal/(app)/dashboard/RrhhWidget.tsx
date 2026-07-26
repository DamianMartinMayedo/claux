import Link from 'next/link'
import { UserCircle } from 'lucide-react'
import type { RrhhResumen } from '@/app/actions/portal/dashboard'

export default function RrhhWidget({ data }: { data: RrhhResumen }) {
  return (
    <section className="card dash-card-sm">
      <div className="card-header">
        <div className="dash-card-head">
          <span className="dash-card-icon metric-icon-success"><UserCircle size={18} /></span>
          <h2 className="card-title">Equipo</h2>
        </div>
        <Link href="/portal/rrhh" className="btn btn-secondary btn-sm">Ver personal</Link>
      </div>

      {/* «Activos» es censo; «sin confirmar» es lo que hay que hacer. Por eso la
          segunda cifra ya no es «altas del mes», que no pedía ninguna acción. */}
      <div className="dash-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">Empleados activos</span>
          <span className="dash-kpi-value">{data.activos}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Nóminas sin confirmar</span>
          <span className={`dash-kpi-value ${data.nominasBorrador > 0 ? 'is-neg' : 'is-pos'}`}>{data.nominasBorrador}</span>
        </div>
      </div>

      {data.contratosPorVencer > 0 ? (
        <ul className="dash-list">
          <li className="dash-list-item">
            <span className="dash-list-main">
              <span className="dash-list-title">Contratos que terminan</span>
              <span className="dash-list-meta">En los próximos 30 días</span>
            </span>
            <span className="dash-list-amount is-neg">{data.contratosPorVencer}</span>
          </li>
        </ul>
      ) : (
        <p className="dash-muted">
          {data.altasMes > 0
            ? `${data.altasMes} alta${data.altasMes === 1 ? '' : 's'} este mes. Ningún contrato termina pronto.`
            : 'Ningún contrato termina en los próximos 30 días.'}
        </p>
      )}
    </section>
  )
}
