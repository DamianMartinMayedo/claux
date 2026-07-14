import { obtenerUsoCliente } from '@/app/actions/admin/metricas'

const ROL_LABEL: Record<string, string> = {
  admin_empresa: 'Administrador',
  usuario:       'Operador',
}

function formatAcceso(fecha: string | null): string {
  if (!fecha) return 'Nunca'
  return new Date(fecha).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default async function UsoClienteCard({ clientId }: { clientId: string }) {
  const uso = await obtenerUsoCliente(clientId)

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="detail-section-title">Uso y actividad</h2>
        <span className="badge badge-neutral">
          {uso.usuariosActivos30} de {uso.usuarios.length} activo{uso.usuarios.length !== 1 ? 's' : ''} (30 días)
        </span>
      </div>

      {/* Usuarios del negocio + último acceso */}
      {uso.usuarios.length === 0 ? (
        <p className="text-sm-muted">Este cliente no tiene usuarios registrados.</p>
      ) : (
        <div className="table-wrapper table-wrapper-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Último acceso</th>
              </tr>
            </thead>
            <tbody>
              {uso.usuarios.map(u => (
                <tr key={u.email} className={u.estado !== 'ACTIVO' ? 'row-inactive' : ''}>
                  <td data-label="Usuario">{u.nombre || u.email}</td>
                  <td data-label="Rol"><span className="badge badge-neutral">{ROL_LABEL[u.rol] ?? u.rol}</span></td>
                  <td data-label="Último acceso" className="table-muted">{formatAcceso(u.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lo que han creado + módulos más usados */}
      <div className="detail-grid uso-cliente-grid">
        <div>
          <h3 className="detail-subsection-title">Lo que han creado</h3>
          {uso.creados.length === 0 ? (
            <p className="text-sm-muted">Sin módulos de datos contratados.</p>
          ) : (
            <div className="table-wrapper table-wrapper-flush">
              <table className="table">
                <thead><tr><th>Tipo de dato</th><th className="col-num">Total</th></tr></thead>
                <tbody>
                  {uso.creados.map(c => (
                    <tr key={c.label}>
                      <td data-label="Tipo de dato">{c.label}</td>
                      <td data-label="Total" className="col-num">{c.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="detail-subsection-title">Módulos más usados</h3>
          {uso.modulosMasUsados.length === 0 ? (
            <p className="text-sm-muted">Sin actividad en los últimos 30 días.</p>
          ) : (
            <div className="table-wrapper table-wrapper-flush">
              <table className="table">
                <thead><tr><th>Módulo</th><th className="col-num">Aperturas</th></tr></thead>
                <tbody>
                  {uso.modulosMasUsados.map(u => (
                    <tr key={u.modulo}>
                      <td data-label="Módulo">{u.modulo}</td>
                      <td data-label="Aperturas" className="col-num">{u.hits}</td>
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
