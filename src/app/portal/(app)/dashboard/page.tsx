// Dashboard — placeholder, se construye al final
export default function DashboardPage() {
  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Resumen general de todas tus empresas.</p>
        </div>
      </div>
      <div className="modulo-placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
        </svg>
        <h3>Dashboard en construcción</h3>
        <p>Comienza configurando tus empresas y monedas.</p>
      </div>
    </div>
  )
}
