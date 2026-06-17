'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
import { useRouter }                        from 'next/navigation'
import {
  guardarContrato,
  eliminarContrato,
  type Contrato,
  type EmpleadoConEstado,
  type TipoContrato,
  type Periodicidad,
  type RrhhPageData,
} from '@/app/actions/portal/rrhh'
import { FileText, Plus, Search, Trash2, X } from 'lucide-react'

// ── Constantes / helpers (mismas etiquetas que el resto del módulo) ─────────────

const TIPO_CONTRATO_LABEL: Record<TipoContrato, string> = {
  INDEFINIDO: 'Indefinido', TEMPORAL: 'Temporal', POR_OBRA: 'Por obra', PRACTICAS: 'Prácticas',
}
const PERIODICIDAD_LABEL: Record<Periodicidad, string> = {
  MENSUAL: 'Mensual', QUINCENAL: 'Quincenal', SEMANAL: 'Semanal', POR_HORA: 'Por hora',
}
const TIPOS_CONTRATO: TipoContrato[]  = ['INDEFINIDO', 'TEMPORAL', 'POR_OBRA', 'PRACTICAS']
const PERIODICIDADES:  Periodicidad[] = ['MENSUAL', 'QUINCENAL', 'SEMANAL', 'POR_HORA']

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function hoyISO(): string { return new Date().toISOString().split('T')[0] }
function formatFecha(f: string | null): string {
  if (!f) return '—'
  const [y, m, d] = f.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
function nombreCompleto(e: EmpleadoConEstado): string {
  return [e.nombre, e.apellidos].filter(Boolean).join(' ')
}

// ── Modal: contratos de un empleado (historial + alta de contrato) ───────────────

function ContratosEmpleadoModal({
  empleado, contratos, onClose, onChanged,
}: {
  empleado:  EmpleadoConEstado
  contratos: Contrato[]
  onClose:   () => void
  onChanged: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [delId, setDelId] = useState<string | null>(null)

  const vigente = contratos.find(c => c.fecha_fin === null) ?? null

  function handleNuevo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('empleado_id', empleado.empleado_id)
    startTransition(async () => {
      const res = await guardarContrato(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      ;(e.target as HTMLFormElement).reset()
      onChanged()
    })
  }

  function handleEliminar(contrato_id: string) {
    startTransition(async () => {
      const res = await eliminarContrato(contrato_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelId(null); return }
      setDelId(null); onChanged()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Contratos · {nombreCompleto(empleado)}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="info-box">
            <strong className="info-box-title">{empleado.cargo ?? 'Sin cargo'} · {empleado.moneda}</strong>
            <span className="text-xs-muted">
              {vigente
                ? `Vigente: ${TIPO_CONTRATO_LABEL[vigente.tipo_contrato]} · ${formatMonto(vigente.salario_base)} ${empleado.moneda} (${PERIODICIDAD_LABEL[vigente.periodicidad]}) desde ${formatFecha(vigente.fecha_inicio)}`
                : 'Sin contrato vigente.'}
            </span>
          </div>

          {/* Registrar nuevo contrato */}
          <form onSubmit={handleNuevo}>
            <span className="ter-form-section-title">Registrar nuevo contrato</span>
            <div className="ter-form-grid">
              <div className="input-group ter-col-span-2">
                <label>Tipo de contrato</label>
                <select className="input" name="tipo_contrato" defaultValue={vigente?.tipo_contrato ?? 'INDEFINIDO'}>
                  {TIPOS_CONTRATO.map(t => <option key={t} value={t}>{TIPO_CONTRATO_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="input-group ter-col-span-2">
                <label>Desde <span className="required">*</span></label>
                <input className="input" name="fecha_inicio" type="date" required defaultValue={hoyISO()} />
              </div>
              <div className="input-group ter-col-span-2">
                <label>Periodicidad</label>
                <select className="input" name="periodicidad" defaultValue={vigente?.periodicidad ?? 'MENSUAL'}>
                  {PERIODICIDADES.map(p => <option key={p} value={p}>{PERIODICIDAD_LABEL[p]}</option>)}
                </select>
              </div>
              <div className="input-group ter-col-span-3">
                <label>Salario base ({empleado.moneda})</label>
                <input className="input" name="salario_base" type="number" min="0" step="0.01"
                  defaultValue={vigente?.salario_base ?? empleado.salario_base ?? ''} placeholder="0.00" />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Notas</label>
                <input className="input" name="notas" placeholder="Renovación, ascenso…" />
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-sm mt-2" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : <><Plus size={14} strokeWidth={2.5} /> Registrar contrato</>}
            </button>
          </form>

          {/* Historial */}
          <span className="ter-form-section-title">Historial</span>
          {contratos.length === 0 ? (
            <p className="text-sm-muted">Sin contratos registrados.</p>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th className="tes-col-monto">Salario</th>
                    <th>Vigencia</th>
                    <th>Estado</th>
                    <th className="alm-col-act"></th>
                  </tr>
                </thead>
                <tbody>
                  {contratos.map(c => (
                    <tr key={c.contrato_id}>
                      <td>
                        {TIPO_CONTRATO_LABEL[c.tipo_contrato]}
                        <div className="text-sm-muted">{PERIODICIDAD_LABEL[c.periodicidad]}{c.notas ? ` · ${c.notas}` : ''}</div>
                      </td>
                      <td className="tes-col-monto tes-monto-cell">{formatMonto(c.salario_base)} {c.moneda}</td>
                      <td className="text-sm-muted tes-nowrap">{formatFecha(c.fecha_inicio)} – {c.fecha_fin ? formatFecha(c.fecha_fin) : 'hoy'}</td>
                      <td>
                        <span className={`badge ${c.fecha_fin === null ? 'badge-success' : 'badge-neutral'}`}>
                          {c.fecha_fin === null ? 'Vigente' : 'Finalizado'}
                        </span>
                      </td>
                      <td>
                        <div className="ter-actions">
                          {delId === c.contrato_id ? (
                            <>
                              <button className="btn btn-danger btn-sm" onClick={() => handleEliminar(c.contrato_id)} disabled={isPending}>Confirmar</button>
                              <button className="btn btn-secondary btn-sm" onClick={() => setDelId(null)} disabled={isPending}>No</button>
                            </>
                          ) : (
                            <button className="ter-action-btn ter-action-danger" title="Eliminar contrato"
                              onClick={() => setDelId(c.contrato_id)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

// ── Página: Contratos ────────────────────────────────────────────────────────────

export default function ContratosView({ data }: { data: RrhhPageData }) {
  const router = useRouter()
  const [search,       setSearch]       = useState('')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [abiertoId,    setAbiertoId]    = useState<string | null>(null)

  // Contratos por empleado
  const porEmpleado = useMemo(() => {
    const m = new Map<string, Contrato[]>()
    for (const c of data.contratos) {
      const arr = m.get(c.empleado_id) ?? []
      arr.push(c)
      m.set(c.empleado_id, arr)
    }
    return m
  }, [data.contratos])

  const empleados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.empleados.filter(e => {
      if (filtroEmpresa && e.empresa_id !== filtroEmpresa) return false
      if (q) {
        const hay = [e.nombre, e.apellidos, e.documento, e.cargo].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data.empleados, search, filtroEmpresa])

  const empleadoAbierto = abiertoId ? data.empleados.find(e => e.empleado_id === abiertoId) ?? null : null

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contratos</h1>
          <p className="page-subtitle">Historial de contratos por empleado: renovaciones y cambios de salario.</p>
        </div>
      </div>

      <div className="ter-toolbar">
        <div className="ter-search-wrap">
          <Search size={16} strokeWidth={2} />
          <input type="search" className="ter-search" placeholder="Buscar por nombre, documento, cargo…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {data.empresas.length > 1 && (
          <select className="input ter-filter-select" value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)}>
            <option value="">Todas las empresas</option>
            {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
          </select>
        )}
      </div>

      <div className="card card-table">
        {empleados.length === 0 ? (
          <div className="mon-empty">
            <FileText size={40} strokeWidth={1} opacity={0.2} />
            <p>{data.empleados.length === 0
              ? 'Aún no hay empleados. Da de alta personal en Personal; su contrato inicial se crea automáticamente.'
              : 'No hay empleados para los filtros seleccionados.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Contrato vigente</th>
                  <th className="tes-col-monto">Salario vigente</th>
                  <th>Contratos</th>
                  <th className="alm-col-act"></th>
                </tr>
              </thead>
              <tbody>
                {empleados.map(e => {
                  const cs      = porEmpleado.get(e.empleado_id) ?? []
                  const vigente = cs.find(c => c.fecha_fin === null) ?? null
                  return (
                    <tr key={e.empleado_id} className="table-row-clickable" onClick={() => setAbiertoId(e.empleado_id)}>
                      <td>
                        <strong>{nombreCompleto(e)}</strong>
                        {e.cargo && <div className="text-sm-muted">{e.cargo}</div>}
                      </td>
                      <td>{vigente ? TIPO_CONTRATO_LABEL[vigente.tipo_contrato] : <span className="text-sm-muted">—</span>}</td>
                      <td className="tes-col-monto tes-monto-cell">
                        {vigente ? `${formatMonto(vigente.salario_base)} ${vigente.moneda}` : '—'}
                      </td>
                      <td className="text-sm-muted">{cs.length}</td>
                      <td>
                        <div className="ter-actions" onClick={ev => ev.stopPropagation()}>
                          <button className="btn btn-secondary btn-sm" onClick={() => setAbiertoId(e.empleado_id)}>
                            <FileText size={14} strokeWidth={2} /> Ver / nuevo
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {empleadoAbierto && (
        <ContratosEmpleadoModal
          empleado={empleadoAbierto}
          contratos={porEmpleado.get(empleadoAbierto.empleado_id) ?? []}
          onClose={() => setAbiertoId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  )
}
