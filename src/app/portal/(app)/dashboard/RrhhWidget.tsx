import Link from 'next/link'
import type { RrhhResumen } from '@/app/actions/portal/dashboard'

export default function RrhhWidget({ data }: { data: RrhhResumen }) {
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Equipo</h2>
        <Link href="/portal/rrhh" className="btn btn-secondary btn-sm">Ver personal</Link>
      </div>

      <div className="dash-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">Empleados activos</span>
          <span className="dash-kpi-value">{data.activos}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Altas del mes</span>
          <span className="dash-kpi-value">{data.altasMes}</span>
        </div>
      </div>

      <p className="dash-muted">Gestiona contratos, turnos y nóminas de tu equipo.</p>
    </section>
  )
}
