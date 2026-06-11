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

// bg / text explícitos para no depender de color-mix ni variables ausentes
const ENTITY_BADGE: Record<string, { bg: string; color: string }> = {
  cliente: { bg: '#DBEAFE', color: '#1D4ED8' },
  plan:    { bg: '#FEF3C7', color: '#92400E' },
  pago:    { bg: '#D1FAE5', color: '#065F46' },
  sistema: { bg: '#F3F4F6', color: '#6B7280' },
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
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>

      {/* ── Barra de filtros ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        flexWrap: 'wrap',
        padding: '12px 20px',
        borderBottom: '1px solid var(--color-border)',
      }}>
        {/* Pills de entidad */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginRight: 2 }}>
            Entidad
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {FILTROS.map(f => {
              const active = filtroEntity === f.value
              return (
                <button
                  key={f.value}
                  onClick={() => setFiltroEntity(f.value)}
                  style={{
                    padding: '3px 12px',
                    borderRadius: 99,
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: active ? 'var(--color-primary-highlight)' : 'transparent',
                    color: active ? 'var(--color-primary-active)' : 'var(--color-text-secondary)',
                    transition: 'all 0.12s ease',
                    lineHeight: '1.5',
                  }}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Buscador */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <input
            className="input"
            style={{ width: '100%' }}
            placeholder="Buscar por descripción, email o ID…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      {/* ── Tabla ── */}
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 155 }}>Fecha</th>
              <th style={{ width: 85  }}>Entidad</th>
              <th style={{ width: 130 }}>Acción</th>
              <th>Descripción</th>
              <th style={{ width: 200 }}>Usuario</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr>
                <td colSpan={5} style={{
                  textAlign: 'center',
                  color: 'var(--color-text-muted)',
                  padding: 'var(--space-8)',
                  fontSize: 'var(--text-sm)',
                }}>
                  Sin registros
                </td>
              </tr>
            ) : filtrados.map(r => {
              const badge = ENTITY_BADGE[r.entity] ?? { bg: '#F3F4F6', color: '#6B7280' }
              return (
                <tr key={r.id}>
                  {/* Fecha */}
                  <td style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                    {formatFecha(r.created_at)}
                  </td>

                  {/* Entidad */}
                  <td>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      padding: '2px 8px', borderRadius: 99,
                      fontSize: 11, fontWeight: 600,
                      background: badge.bg, color: badge.color,
                      whiteSpace: 'nowrap',
                    }}>
                      {ENTITY_LABEL[r.entity] ?? r.entity}
                    </span>
                  </td>

                  {/* Acción */}
                  <td style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                    {ACTION_LABEL[r.action] ?? r.action}
                  </td>

                  {/* Descripción */}
                  <td style={{ fontSize: 'var(--text-sm)' }}>
                    {r.description}
                    {r.entity_id && (
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                        [{r.entity_id}]
                      </span>
                    )}
                  </td>

                  {/* Usuario */}
                  <td style={{ fontSize: 12, color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>
                    {r.user_email}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer contador ── */}
      <div style={{
        padding: '10px 20px',
        fontSize: 12,
        color: 'var(--color-text-muted)',
        borderTop: '1px solid var(--color-border)',
      }}>
        {filtrados.length} registro{filtrados.length !== 1 ? 's' : ''}
        {filtrados.length !== registros.length && ` de ${registros.length}`}
      </div>
    </div>
  )
}
