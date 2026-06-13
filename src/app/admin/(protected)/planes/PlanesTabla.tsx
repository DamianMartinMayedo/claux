'use client'

import { useState, useMemo, Fragment } from 'react'
import EditarPlanModal  from './EditarPlanModal'
import DuplicarPlanBtn  from './DuplicarPlanBtn'
import EliminarPlanBtn  from './EliminarPlanBtn'
import { NIVEL_BADGE, NIVEL_LABEL, MODALIDAD_LABEL } from '@/lib/badges'

const PLAN_ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', INACTIVO: 'badge-error', OCULTO: 'badge-warning',
}
const MODULOS_LABEL: Record<string, string> = {
  ventas: 'Ventas', compras: 'Compras', tesoreria: 'Tesorería',
  terceros: 'C / P', contabilidad_simple: 'Contab. Simple',
  modulo_contable: 'Módulo Contable', inventario: 'Inventario',
  rrhh: 'RR.HH.', gestion_documental: 'Gest. Documental',
  rol_contador_externo: 'Contador Ext.', multiempresa: 'Multiempresa',
  presupuestos: 'Presupuestos', crm: 'CRM', activos_fijos: 'Activos Fijos',
}

type Plan = {
  plan_id: string; nombre: string; descripcion: string | null
  nivel: string; modalidad: string; precio_usd: number
  duracion_dias: number; dias_trial: number
  max_empresas: number; max_usuarios: number
  modulos: string | string[] | null
  estado: string; visible: boolean
}

const POR_PAGINA = 10

function parseModulos(raw: string | string[] | null): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  return raw.split(',').map(m => m.trim()).filter(Boolean)
}


export default function PlanesTabla({ planes }: { planes: Plan[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pagina, setPagina]     = useState(1)

  const totalPaginas = Math.ceil(planes.length / POR_PAGINA)
  const paginados = useMemo(
    () => planes.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA),
    [planes, pagina],
  )

  function toggle(id: string) { setExpanded(prev => prev === id ? null : id) }

  return (
    <div className="table-wrapper">
      <table className="table">
        <thead>
          <tr>
            <th className="plan-expand-col" />
            <th>Plan</th>
            <th>Nivel</th>
            <th>Precio</th>
            <th>Duración</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {paginados.map(p => {
            const isOpen  = expanded === p.plan_id
            const modulos = parseModulos(p.modulos)
            return (
              <Fragment key={p.plan_id}>
                <tr className="plan-row-expandable" onClick={() => toggle(p.plan_id)}>
                  <td className="plan-expand-td">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      className={`plan-expand-chevron${isOpen ? ' expanded' : ''}`}>
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </td>
                  <td>
                    <div className="table-empresa">{p.nombre}</div>
                    {p.descripcion && <div className="table-empresa-contact">{p.descripcion}</div>}
                  </td>
                  <td>
                    <span className={`badge ${NIVEL_BADGE[p.nivel] ?? 'badge-neutral'}`}>
                      {NIVEL_LABEL[p.nivel] ?? p.nivel}
                    </span>
                  </td>
                  <td className="table-price">${p.precio_usd?.toFixed(2)}</td>
                  <td className="table-muted">{p.duracion_dias ?? '—'} días</td>
                  <td>
                    <span className={`badge badge-dot ${PLAN_ESTADO_BADGE[p.estado] ?? 'badge-neutral'}`}>
                      {p.estado}
                    </span>
                  </td>
                  <td className="table-actions-right" onClick={e => e.stopPropagation()}>
                    <div className="table-actions-group">
                      <EditarPlanModal plan={p} />
                      <DuplicarPlanBtn plan={p} />
                      <EliminarPlanBtn planId={p.plan_id} planNombre={p.nombre} />
                    </div>
                  </td>
                </tr>

                {isOpen && (
                  <tr key={`${p.plan_id}-d`} className="plan-expand-row">
                    <td colSpan={7} className="plan-expand-cell">
                      <div className="plan-expand-panel">
                        <div className="plan-panel-row">

                          {/* 6 items de detalle en fila horizontal */}
                          <div className="plan-panel-items">
                            {([
                              ['ID técnico',    <span key="id" className="table-code-muted">{p.plan_id}</span>],
                              ['Modalidad',     MODALIDAD_LABEL[p.modalidad] ?? p.modalidad ?? '—'],
                              ['Trial',         p.dias_trial ? `${p.dias_trial} días` : 'Sin trial'],
                              ['Máx. empresas', String(p.max_empresas ?? '—')],
                              ['Máx. usuarios', p.max_usuarios === -1 ? 'Ilimitado' : String(p.max_usuarios ?? '—')],
                              ['Visible',       <span key="v" className={`badge text-xs ${p.visible ? 'badge-success' : 'badge-neutral'}`}>{p.visible ? 'Sí' : 'No'}</span>],
                            ] as [string, React.ReactNode][]).map(([label, value]) => (
                              <div key={label} className="plan-panel-item">
                                <span className="plan-panel-label">{label}</span>
                                <span className="plan-panel-value">{value}</span>
                              </div>
                            ))}
                          </div>

                          {/* Separador vertical */}
                          <div className="plan-panel-sep" />

                          {/* Módulos a la derecha */}
                          <div className="plan-panel-mods">
                            <span className="plan-panel-mods-label">
                              Módulos ({modulos.length})
                            </span>
                            {modulos.length > 0 ? (
                              <div className="plan-mod-list">
                                {modulos.map(m => (
                                  <span key={m} className="badge badge-neutral text-xs">
                                    {MODULOS_LABEL[m] ?? m}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm-muted">Sin módulos</span>
                            )}
                          </div>
                        </div>

                        {/* Descripción en línea separada si existe */}
                        {p.descripcion && (
                          <div className="plan-panel-desc">
                            {p.descripcion}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {/* Paginación */}
      {totalPaginas > 1 && (
        <div className="pagination">
          <span>{planes.length} planes · Página {pagina} de {totalPaginas}</span>
          <div className="pagination-controls">
            <button className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}>‹ Ant.</button>
            <button className="btn btn-secondary btn-sm" disabled={pagina >= totalPaginas} onClick={() => setPagina(p => p + 1)}>Sig. ›</button>
          </div>
        </div>
      )}
    </div>
  )
}
