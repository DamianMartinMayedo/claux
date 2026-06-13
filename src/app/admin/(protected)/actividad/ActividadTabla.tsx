'use client'

import { useState, useMemo } from 'react'

type Registro = {
  id: number
  created_at: string
  user_email: string
  entity: string
  entity_id: string | null
  action: string
  description: string
}

const ENTITY_LABEL: Record<string, string> = {
  cliente: 'Cliente',
  plan:    'Plan',
  pago:    'Pago',
  sistema: 'Sistema',
}

const ACTION_LABEL: Record<string, string> = {
  crear:          'Crear',
  editar:         'Editar',
  eliminar:       'Eliminar',
  duplicar:       'Duplicar',
  registrar:      'Registrar',
  cambiar_plan:   'Cambiar plan',
  cambiar_estado: 'Cambiar estado',
  gracia:         'Período especial',
  configuracion:  'Configuración',
}

const FILTROS = [
  { value: '',        label: 'Todas' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'plan',    label: 'Plan' },
  { value: 'pago',    label: 'Pago' },
  { value: 'sistema', label: 'Sistema' },
]

function formatFecha(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function ActividadTabla({ registros }: { registros: Registro[] }) {
  const [filtroEntity, setFiltroEntity] = useState('')
  const [busqueda,     setBusqueda]     = useState('')

  const filtrados = useMemo(() => {
    return registros.filter(r => {
      if (filtroEntity && r.entity !== filtroEntity) return false
      if (busqueda) {
        const q = busqueda.toLowerCase()
        return (
          r.description.toLowerCase().includes(q) ||
          r.user_email.toLowerCase().includes(q)  ||
          (r.entity_id ?? '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [registros, filtroEntity, busqueda])

  return (
    <div className="card card-table">

      {/* ── Barra de filtros ── */}
      <div className="act-toolbar">
        {/* Pills de entidad */}
        <div className="act-filters-group">
          <span className="act-filter-label">Entidad</span>
          <div className="act-pills">
            {FILTROS.map(f => (
              <button
                key={f.value}
                onClick={() => setFiltroEntity(f.value)}
                className={`act-pill${filtroEntity === f.value ? ' active' : ''}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Buscador */}
        <div className="act-search-wrap">
          <input
            className="input input-full"
            placeholder="Buscar por descripción, email o ID…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="act-table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th className="act-col-date">Fecha</th>
              <th className="act-col-entity">Entidad</th>
              <th className="act-col-action">Acción</th>
              <th>Descripción</th>
              <th className="act-col-user">Usuario</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr>
                <td colSpan={5} className="act-empty-td">
                  Sin registros
                </td>
              </tr>
            ) : filtrados.map(r => (
              <tr key={r.id}>
                <td className="act-date-cell">
                  {formatFecha(r.created_at)}
                </td>

                <td>
                  <span className={`act-entity-badge act-badge-${r.entity}`}>
                    {ENTITY_LABEL[r.entity] ?? r.entity}
                  </span>
                </td>

                <td className="act-action-cell">
                  {ACTION_LABEL[r.action] ?? r.action}
                </td>

                <td className="act-desc-cell">
                  {r.description}
                  {r.entity_id && (
                    <span className="act-entity-id">[{r.entity_id}]</span>
                  )}
                </td>

                <td className="act-user-cell">
                  {r.user_email}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer contador ── */}
      <div className="act-footer">
        {filtrados.length} registro{filtrados.length !== 1 ? 's' : ''}
        {filtrados.length !== registros.length && ` de ${registros.length}`}
      </div>
    </div>
  )
}
