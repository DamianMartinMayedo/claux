import type { DiagnosticoLead } from '@/app/actions/diagnostico'

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function SolicitudesView({ leads }: { leads: DiagnosticoLead[] }) {
  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Solicitudes de diagnóstico</h1>
          <p className="page-subtitle">
            {leads.length} {leads.length === 1 ? 'solicitud recibida' : 'solicitudes recibidas'} desde el diagnóstico público.
          </p>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="card">
          <p className="text-sm-muted">
            Aún no hay solicitudes. Cuando alguien complete el diagnóstico en la web, aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Contacto</th>
                  <th>Sector</th>
                  <th>Necesidades</th>
                  <th>Módulos recomendados</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Nombre">{l.nombre}</td>
                    <td data-label="Contacto">
                      <div>{l.telefono}</div>
                      {l.email && <div className="text-xs-muted">{l.email}</div>}
                    </td>
                    <td data-label="Sector">{l.sector}</td>
                    <td data-label="Necesidades">{(l.necesidades ?? []).join(', ') || '—'}</td>
                    <td data-label="Módulos recomendados">{(l.modulos_rec ?? []).join(', ') || '—'}</td>
                    <td data-label="Fecha">{fmtFecha(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
