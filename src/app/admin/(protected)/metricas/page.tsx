import { requireAccesoPagina } from '@/lib/admin-guard'
import { Activity, Sparkles, UserCheck, Users } from 'lucide-react'
import { obtenerMetricasGenerales } from '@/app/actions/admin/metricas'

const TIPO_LABEL: Record<string, string> = {
  base:          'Módulo',
  modulo:        'Módulo',
  funcionalidad: 'Funcionalidad',
  addon:         'Addon',
}

export default async function MetricasPage() {
  await requireAccesoPagina('metricas')
  const m = await obtenerMetricasGenerales()

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Métricas de uso</h1>
          <p className="page-subtitle">Cómo usan los negocios la plataforma</p>
        </div>
      </div>

      {/* ── KPIs generales ── */}
      <div className="metrics-grid metrics-grid-4">
        <div className="metric-card">
          <div className="metric-icon metric-icon-primary"><Users size={20} /></div>
          <p className="metric-label">Negocios totales</p>
          <p className="metric-value">{m.totalTenants}</p>
          <p className="metric-sub">Registrados en el sistema</p>
        </div>
        <div className="metric-card">
          <div className="metric-icon metric-icon-success"><Activity size={20} /></div>
          <p className="metric-label">Negocios activos</p>
          <p className="metric-value">{m.tenantsActivos30}</p>
          <p className="metric-sub">Con actividad en 30 días ({m.tenantsActivos7} en 7)</p>
        </div>
        <div className="metric-card">
          <div className="metric-icon metric-icon-teal"><UserCheck size={20} /></div>
          <p className="metric-label">Usuarios activos</p>
          <p className="metric-value">{m.usuariosActivos30}</p>
          <p className="metric-sub">En 30 días ({m.usuariosActivos7} en 7)</p>
        </div>
        <div className="metric-card">
          <div className="metric-icon metric-icon-amber"><Sparkles size={20} /></div>
          <p className="metric-label">Conversaciones IA</p>
          <p className="metric-value">{m.iaConversaciones}</p>
          <p className="metric-sub">Este mes · {m.iaTokens.toLocaleString('es-ES')} tokens</p>
        </div>
      </div>

      {/* ── Adopción de módulos y addons ── */}
      <div className="card">
        <h2 className="detail-section-title">Módulos y addons más contratados</h2>
        <div className="table-wrapper table-wrapper-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Módulo</th>
                <th>Tipo</th>
                <th className="col-num">Negocios</th>
                <th className="col-num">Ingreso mensual</th>
              </tr>
            </thead>
            <tbody>
              {m.adopcion.map(a => (
                <tr key={a.clave}>
                  <td data-label="Módulo">{a.nombre}</td>
                  <td data-label="Tipo"><span className="badge badge-neutral">{TIPO_LABEL[a.tipo] ?? a.tipo}</span></td>
                  <td data-label="Negocios" className="col-num">{a.contratados}</td>
                  <td data-label="Ingreso mensual" className="col-num table-price">${a.ingresoMensual.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Módulos más usados + sectores ── */}
      <div className="detail-grid">
        <div className="card">
          <h2 className="detail-section-title">Módulos más usados</h2>
          {m.modulosMasUsados.length === 0 ? (
            <p className="text-sm-muted">Aún no hay actividad registrada.</p>
          ) : (
            <div className="table-wrapper table-wrapper-flush">
              <table className="table">
                <thead>
                  <tr><th>Módulo</th><th className="col-num">Aperturas (30 días)</th></tr>
                </thead>
                <tbody>
                  {m.modulosMasUsados.map(u => (
                    <tr key={u.modulo}>
                      <td data-label="Módulo">{u.modulo}</td>
                      <td data-label="Aperturas (30 días)" className="col-num">{u.hits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="detail-section-title">Negocios por sector</h2>
          {m.porSector.length === 0 ? (
            <p className="text-sm-muted">Sin negocios registrados.</p>
          ) : (
            <div className="table-wrapper table-wrapper-flush">
              <table className="table">
                <thead>
                  <tr><th>Sector</th><th className="col-num">Negocios</th></tr>
                </thead>
                <tbody>
                  {m.porSector.map(s => (
                    <tr key={s.sector}>
                      <td data-label="Sector">{s.sector}</td>
                      <td data-label="Negocios" className="col-num">{s.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
