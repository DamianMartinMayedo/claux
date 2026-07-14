'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import { useState, useTransition, useMemo } from 'react'
import { useRouter }                        from 'next/navigation'
import {
  guardarTurno,
  eliminarTurno,
  asignarTurno,
  type Turno,
  type RrhhPageData,
} from '@/app/actions/portal/rrhh'
import { Clock, Pencil, Plus, Trash2, X } from 'lucide-react'

// ── Constantes ────────────────────────────────────────────────────────────────

const DIAS = [
  { n: 1, label: 'Lun' }, { n: 2, label: 'Mar' }, { n: 3, label: 'Mié' },
  { n: 4, label: 'Jue' }, { n: 5, label: 'Vie' }, { n: 6, label: 'Sáb' }, { n: 7, label: 'Dom' },
]

const TURNO_COLORS = [
  { value: '#00AFAA', label: 'Teal' },
  { value: '#C97A0C', label: 'Ámbar' },
  { value: '#2E7D32', label: 'Verde' },
  { value: '#1565C0', label: 'Azul' },
  { value: '#6A1B9A', label: 'Morado' },
  { value: '#AD1457', label: 'Rosa' },
]

function formatHora(h: string | null): string {
  return h ? h.slice(0, 5) : ''
}
function horario(t: Turno): string {
  const i = formatHora(t.hora_inicio), f = formatHora(t.hora_fin)
  if (i && f) return `${i}–${f}`
  return i || f || 'Sin horario'
}

// ── Modal: crear / editar turno ──────────────────────────────────────────────────

function TurnoModal({
  turno, empresaId, onClose, onSaved,
}: {
  turno:     Turno | null
  empresaId: string
  onClose:   () => void
  onSaved:   () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!turno

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('empresa_id', empresaId)
    startTransition(async () => {
      const res = await guardarTurno(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar turno' : 'Nuevo turno'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {turno && <input type="hidden" name="turno_id" value={turno.turno_id} />}
          <div className="modal-body">
            <div className="ter-form-grid">
              <div className="input-group ter-col-full">
                <label>Nombre <span className="required">*</span></label>
                <input className="input" name="nombre" required autoFocus defaultValue={turno?.nombre ?? ''} placeholder="Mañana, Tarde, Noche…" />
              </div>
              <div className="input-group ter-col-span-2">
                <label>Hora inicio</label>
                <input className="input" name="hora_inicio" type="time" defaultValue={formatHora(turno?.hora_inicio ?? null)} />
              </div>
              <div className="input-group ter-col-span-2">
                <label>Hora fin</label>
                <input className="input" name="hora_fin" type="time" defaultValue={formatHora(turno?.hora_fin ?? null)} />
              </div>
              <div className="input-group ter-col-span-2">
                <label>Color</label>
                <select className="input" name="color" defaultValue={turno?.color ?? TURNO_COLORS[0].value}>
                  {TURNO_COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : isEdit ? 'Guardar cambios' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Celda de asignación (un empleado × un día) ───────────────────────────────────

function CeldaTurno({
  empleadoId, dia, diaLabel, turnoIdActual, turnos, onChanged,
}: {
  empleadoId:    string
  dia:           number
  diaLabel:      string
  turnoIdActual: string
  turnos:        Turno[]
  onChanged:     () => void
}) {
  const [isPending, startTransition] = useTransition()

  function handleChange(turno_id: string) {
    const fd = new FormData()
    fd.set('empleado_id', empleadoId)
    fd.set('dia_semana', String(dia))
    fd.set('turno_id', turno_id)
    startTransition(async () => {
      const res = await asignarTurno(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  const color = turnos.find(t => t.turno_id === turnoIdActual)?.color ?? null

  return (
    <td className="turno-cell" data-label={diaLabel}>
      <div className="turno-cell-wrap" style={color ? ({ '--turno-color': color } as React.CSSProperties) : undefined}>
        {color && <span className="turno-dot" />}
        <select className="input turno-grid-select" value={turnoIdActual}
          onChange={e => handleChange(e.target.value)} disabled={isPending}
          aria-label={`Turno del día ${dia}`}>
          <option value="">—</option>
          {turnos.map(t => <option key={t.turno_id} value={t.turno_id}>{t.nombre}</option>)}
        </select>
      </div>
    </td>
  )
}

// ── Página: Turnos ───────────────────────────────────────────────────────────────

export default function TurnosView({ data }: { data: RrhhPageData }) {
  const router = useRouter()
  const [empresaId, setEmpresaId] = useState(data.empresas[0]?.empresa_id ?? '')
  const [modalTurno, setModalTurno] = useState<Turno | null>(null)
  const [modalNuevo, setModalNuevo] = useState(false)
  const [delTurno,   setDelTurno]   = useState<Turno | null>(null)
  const [isPending,  startTransition] = useTransition()

  const turnos = useMemo(
    () => data.turnos_catalogo.filter(t => t.empresa_id === empresaId),
    [data.turnos_catalogo, empresaId],
  )
  const empleados = useMemo(
    () => data.empleados.filter(e => e.estado === 'ACTIVO' && e.empresa_id === empresaId),
    [data.empleados, empresaId],
  )
  const asignMap = useMemo(() => {
    const m = new Map<string, string>()   // `${empleado_id}-${dia}` → turno_id
    for (const a of data.asignaciones) m.set(`${a.empleado_id}-${a.dia_semana}`, a.turno_id)
    return m
  }, [data.asignaciones])

  function onChanged() { router.refresh() }

  function confirmarEliminarTurno() {
    if (!delTurno) return
    startTransition(async () => {
      const res = await eliminarTurno(delTurno.turno_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelTurno(null); return }
      setDelTurno(null); router.refresh()
    })
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Turnos</h1>
          <p className="page-subtitle">Catálogo de turnos por empresa y planificación semanal del personal.</p>
        </div>
        <div className="tes-header-actions">
          <button className="btn btn-primary" onClick={() => setModalNuevo(true)} disabled={!empresaId}>
            <Plus size={14} strokeWidth={2.5} /> Nuevo turno
          </button>
        </div>
      </div>

      {data.empresas.length === 0 && (
        <PrerequisitoAviso acciones={[{ label: 'Crear empresa', href: '/portal/empresas' }]}>
          Para crear turnos necesitas <strong>una empresa</strong>.
        </PrerequisitoAviso>
      )}

      {data.empresas.length > 1 && (
        <div className="ter-toolbar">
          <select className="input ter-filter-select" value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
            {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
          </select>
        </div>
      )}

      {/* Catálogo de turnos */}
      <div className="card card-table rrhh-card-gap">
        <div className="ter-card-head"><span className="ter-form-section-title">Turnos de la empresa</span></div>
        {turnos.length === 0 ? (
          <div className="mon-empty">
            <Clock size={36} strokeWidth={1} opacity={0.2} />
            <p>Crea los turnos de esta empresa (p. ej. Mañana 08:00–14:00) para poder asignarlos en la rejilla semanal.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Turno</th><th>Horario</th><th className="col-actions"></th></tr>
              </thead>
              <tbody>
                {turnos.map(t => (
                  <tr key={t.turno_id}>
                    <td data-label="Turno">
                      <div className="turno-name">
                        {t.color && <span className="turno-dot" style={{ '--turno-color': t.color } as React.CSSProperties} />}
                        <strong>{t.nombre}</strong>
                      </div>
                    </td>
                    <td data-label="Horario" className="text-sm-muted">{horario(t)}</td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => setModalTurno(t)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                        <button className="row-actions-item row-actions-item-danger"
                          onClick={() => setDelTurno(t)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rejilla semanal */}
      <div className="card card-table">
        <div className="ter-card-head"><span className="ter-form-section-title">Asignación semanal</span></div>
        {empleados.length === 0 ? (
          <div className="mon-empty">
            <Clock size={36} strokeWidth={1} opacity={0.2} />
            <p>No hay empleados activos en esta empresa para planificar.</p>
          </div>
        ) : turnos.length === 0 ? (
          <div className="mon-empty">
            <Clock size={36} strokeWidth={1} opacity={0.2} />
            <p>Crea al menos un turno arriba para empezar a asignarlo por día.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table turno-grid">
              <thead>
                <tr>
                  <th className="turno-grid-emp">Empleado</th>
                  {DIAS.map(d => <th key={d.n}>{d.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {empleados.map(e => (
                  <tr key={e.empleado_id}>
                    <td className="turno-grid-emp" data-label="Empleado">
                      <strong>{[e.nombre, e.apellidos].filter(Boolean).join(' ')}</strong>
                      {e.cargo && <div className="text-sm-muted">{e.cargo}</div>}
                    </td>
                    {DIAS.map(d => (
                      <CeldaTurno key={d.n} empleadoId={e.empleado_id} dia={d.n} diaLabel={d.label}
                        turnoIdActual={asignMap.get(`${e.empleado_id}-${d.n}`) ?? ''}
                        turnos={turnos} onChanged={onChanged} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(modalNuevo || modalTurno) && (
        <TurnoModal turno={modalTurno} empresaId={empresaId}
          onClose={() => { setModalNuevo(false); setModalTurno(null) }}
          onSaved={() => { setModalNuevo(false); setModalTurno(null); router.refresh() }} />
      )}
      {delTurno && (
        <div className="modal-backdrop open">
          <div className="modal modal-sm" role="dialog" aria-modal>
            <div className="modal-header">
              <h2 className="modal-title">Eliminar turno</h2>
              <button type="button" className="modal-close" onClick={() => setDelTurno(null)}><X size={16} strokeWidth={2} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-body-text">¿Eliminar el turno <strong>{delTurno.nombre}</strong>? Se quitará de todas las asignaciones semanales.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setDelTurno(null)}>Cancelar</button>
              <button type="button" className="btn btn-danger" onClick={confirmarEliminarTurno} disabled={isPending}>
                {isPending ? <><span className="spinner spinner-sm" /> Eliminando…</> : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
