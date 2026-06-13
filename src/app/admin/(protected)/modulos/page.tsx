import { createClient } from '@/lib/supabase/server'
import EditarModuloModal from './EditarModuloModal'

const TIPO_LABEL: Record<string, string> = {
  base:          'Base',
  modulo:        'Módulo',
  funcionalidad: 'Funcionalidad',
}

export default async function ModulosPage() {
  const supabase = await createClient()

  const { data: modulos } = await supabase
    .from('modulos_catalogo')
    .select('*')
    .order('orden')

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Catálogo de módulos</h1>
          <p className="page-subtitle">
            Precios fundador / estándar de cada módulo y funcionalidad. Edita los precios aquí y se aplicarán al recalcular el precio de cada cliente.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper table-wrapper-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Clave</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Fundador</th>
                <th>Estándar</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(modulos ?? []).map(m => (
                <tr key={m.clave}>
                  <td className="table-muted">
                    <code className="code-id">{m.clave}</code>
                  </td>
                  <td>
                    <div>{m.nombre}</div>
                    {m.descripcion && <div className="text-xs-muted">{m.descripcion}</div>}
                  </td>
                  <td>
                    <span className={`mod-tipo-badge mod-tipo-${m.tipo === 'funcionalidad' ? 'func' : m.tipo}`}>
                      {TIPO_LABEL[m.tipo] ?? m.tipo}
                    </span>
                  </td>
                  <td className="table-price">${Number(m.precio_fundador_usd).toFixed(2)}</td>
                  <td className="table-price">${Number(m.precio_estandar_usd).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${m.activo ? 'badge-success' : 'badge-error'}`}>
                      {m.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <EditarModuloModal modulo={m} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
