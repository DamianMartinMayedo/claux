'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  guardarServicio, eliminarServicio,
  guardarRecurso, eliminarRecurso, importarPersonalRRHH,
  crearCitaManual, cambiarEstadoCita,
  guardarBotConfigCitas, eliminarBotConfigCitas, toggleActivoBotCitas, toggleIaBotCitas, guardarConfirmacionCitas,
  obtenerSlotsCita, obtenerDiasDisponiblesCita,
  type CitasPageData, type Servicio, type Recurso, type CitaConDetalle, type SlotCita, type DiaDisponible,
} from '@/app/actions/portal/citas'
import { guardarSlug } from '@/app/actions/portal/reservas'
import CierresSection from '@/components/portal/CierresSection'
import { RowActions } from '@/components/portal/RowActions'
import { usePagination, TablePagination } from '@/components/TablePagination'
import ReglasReservaSection from '@/components/portal/ReglasReservaSection'
import IaBotBanner from '@/components/portal/IaBotBanner'
import { type EstadoReserva } from '@/lib/reservas/estado'
import { CalendarDays, Check, Copy, Download, Pencil, Plus, Power, PowerOff, Search, Trash2, UserX, X } from 'lucide-react'

// ── Constantes ────────────────────────────────────────────────────────────────

const ESTADO_LABEL: Record<EstadoReserva, string> = {
  PENDIENTE: 'Pendiente', CONFIRMADA: 'Confirmada', RECHAZADA: 'Rechazada',
  NO_SHOW: 'No asistió', CANCELADA: 'Cancelada',
}
const ESTADO_BADGE: Record<EstadoReserva, string> = {
  PENDIENTE: 'badge-warning', CONFIRMADA: 'badge-success', RECHAZADA: 'badge-neutral',
  NO_SHOW: 'badge-danger', CANCELADA: 'badge-neutral',
}
const CANAL_LABEL: Record<string, string> = { web: 'Web', bot: 'Bot', manual: 'Manual' }
const DIA_LABEL: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' }
const MEDIAS_HORAS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function hoyISO(): string { return new Date().toISOString().split('T')[0] }
function mananaISO(): string { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0] }
function fechaChip(f: string): string {
  if (f === hoyISO())    return 'Hoy'
  if (f === mananaISO()) return 'Mañana'
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
}
function formatFecha(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}
function formatHora(h: string | null): string { return h ? h.substring(0, 5) : '—' }
function formatPrecio(p: number | null): string { return p == null ? '—' : `$${p.toFixed(2)}` }

// ── Modal: servicio ─────────────────────────────────────────────────────────

function ServicioModal({ servicio, etiqueta, onClose, onSaved }: {
  servicio: Servicio | null
  etiqueta: string
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!servicio

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (servicio) fd.set('servicio_id', servicio.servicio_id)
    startTransition(async () => {
      const res = await guardarServicio(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(isEdit ? `${etiqueta} actualizado.` : `${etiqueta} creado.`)
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? `Editar ${etiqueta.toLowerCase()}` : `Nuevo ${etiqueta.toLowerCase()}`}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="ter-form-grid">
              <div className="input-group ter-col-full">
                <label>Nombre <span className="required">*</span></label>
                <input className="input" name="nombre" required autoFocus={!isEdit}
                  defaultValue={servicio?.nombre ?? ''} placeholder="Corte de pelo, Consulta…" />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Duración (min) <span className="required">*</span></label>
                <input className="input" name="duracion_minutos" type="number" min="5" step="5" required
                  defaultValue={servicio?.duracion_minutos ?? 30} />
                <span className="input-hint">Tiempo que ocupa cada cita.</span>
              </div>
              <div className="input-group ter-col-span-3">
                <label>Precio (USD)</label>
                <input className="input" name="precio" type="number" min="0" step="0.01"
                  defaultValue={servicio?.precio ?? ''} placeholder="Opcional" />
              </div>
              <div className="input-group ter-col-full">
                <label className="cita-chk-item">
                  <input type="checkbox" name="activo" value="true" defaultChecked={servicio?.activo ?? true} />
                  Activo (visible para reservar)
                </label>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : isEdit ? 'Guardar cambios' : `Crear ${etiqueta.toLowerCase()}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: recurso / profesional ──────────────────────────────────────────────

function RecursoModal({ recurso, servicios, etiquetaRec, etiquetaSrv, onClose, onSaved }: {
  recurso: Recurso | null
  servicios: Servicio[]
  etiquetaRec: string
  etiquetaSrv: string
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!recurso
  const horaDe = (dia: number, campo: 'hora_inicio' | 'hora_fin') =>
    recurso?.horarios.find(h => h.dia_semana === dia)?.[campo] ?? ''

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (recurso) fd.set('recurso_id', recurso.recurso_id)
    startTransition(async () => {
      const res = await guardarRecurso(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(isEdit ? `${etiquetaRec} actualizado.` : `${etiquetaRec} creado.`)
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? `Editar ${etiquetaRec.toLowerCase()}` : `Nuevo ${etiquetaRec.toLowerCase()}`}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="ter-form-grid">
              {/* Preserva el vínculo con RRHH al editar un recurso importado */}
              <input type="hidden" name="empleado_id" defaultValue={recurso?.empleado_id ?? ''} />
              <div className="input-group ter-col-span-3">
                <label>Nombre <span className="required">*</span></label>
                <input className="input" name="nombre" required autoFocus={!isEdit}
                  defaultValue={recurso?.nombre ?? ''} placeholder={`${etiquetaRec}…`} />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Tipo</label>
                <input className="input" name="tipo" defaultValue={recurso?.tipo ?? ''} placeholder="Opcional" />
              </div>

              <div className="input-group ter-col-full">
                <label>{etiquetaSrv}s que atiende</label>
                {servicios.length === 0 ? (
                  <span className="input-hint">Aún no hay servicios. Créalos en la pestaña «Servicios» (si solo das un tipo de cita, basta con uno).</span>
                ) : (
                  <div className="cita-chk-list">
                    {servicios.map(s => (
                      <label key={s.servicio_id} className="cita-chk-item">
                        <input type="checkbox" name="servicio_ids" value={s.servicio_id}
                          defaultChecked={recurso ? recurso.servicio_ids.includes(s.servicio_id) : false} />
                        {s.nombre} <span className="text-xs-muted">({s.duracion_minutos} min)</span>
                      </label>
                    ))}
                  </div>
                )}
                <span className="input-hint">Sin selección = atiende todos los servicios.</span>
              </div>

              <div className="input-group ter-col-full">
                <label>Horario semanal</label>
                <div className="cita-hor-grid">
                  {[1, 2, 3, 4, 5, 6, 7].map(d => (
                    <div key={d} className="cita-hor-row">
                      <span className="cita-hor-day">{DIA_LABEL[d]}</span>
                      <select className="input" name={`hor_${d}_inicio`} defaultValue={horaDe(d, 'hora_inicio')}>
                        <option value="">—</option>
                        {MEDIAS_HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <span className="cita-hor-sep">a</span>
                      <select className="input" name={`hor_${d}_fin`} defaultValue={horaDe(d, 'hora_fin')}>
                        <option value="">—</option>
                        {MEDIAS_HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <span className="input-hint">Deja un día en blanco si no atiende. Necesario para reservas en línea.</span>
              </div>

              <div className="input-group ter-col-full">
                <label className="cita-chk-item">
                  <input type="checkbox" name="activo" value="true" defaultChecked={recurso?.activo ?? true} />
                  Activo
                </label>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : isEdit ? 'Guardar cambios' : `Crear ${etiquetaRec.toLowerCase()}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: nueva cita (manual) ────────────────────────────────────────────────

function NuevaCitaModal({ data, onClose, onSaved }: {
  data: CitasPageData
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [servicioId, setServicioId] = useState('')
  const [recursoId,  setRecursoId]  = useState('')
  const [fecha,      setFecha]      = useState(hoyISO())
  const [hora,       setHora]       = useState('')
  const [slots,      setSlots]      = useState<SlotCita[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [dias,       setDias]       = useState<DiaDisponible[]>([])  // próximos días con hueco
  const [loadingDias, setLoadingDias] = useState(false)

  const recursosActivos = data.recursos.filter(r => r.activo)
  // Recursos que prestan el servicio elegido (sin asignaciones = presta todos)
  const recursosParaServicio = useMemo(() =>
    !servicioId ? recursosActivos
      : recursosActivos.filter(r => r.servicio_ids.length === 0 || r.servicio_ids.includes(servicioId)),
    [recursosActivos, servicioId])

  // Al elegir servicio + recurso, buscar los próximos días con hueco y saltar al
  // primero (no depende de la fecha → no pisa la que el usuario elija después).
  useEffect(() => {
    if (!servicioId || !recursoId) { setDias([]); return }
    let cancel = false
    setLoadingDias(true)
    obtenerDiasDisponiblesCita(data.client_id, servicioId, recursoId).then(ds => {
      if (cancel) return
      setDias(ds)
      if (ds.length > 0) setFecha(ds[0].fecha)
      setLoadingDias(false)
    }).catch(() => { if (!cancel) setLoadingDias(false) })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioId, recursoId])

  // Cargar huecos libres cuando hay servicio + recurso + fecha
  useEffect(() => {
    if (!servicioId || !recursoId || !fecha) { setSlots([]); setHora(''); return }
    let cancel = false
    setLoadingSlots(true); setHora('')
    obtenerSlotsCita(data.client_id, servicioId, recursoId, fecha).then(s => {
      if (cancel) return
      setSlots(s); setLoadingSlots(false)
    }).catch(() => { if (!cancel) { setSlots([]); setLoadingSlots(false) } })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioId, recursoId, fecha])

  const horasLibres = useMemo(() => Array.from(new Set(slots.map(s => s.hora))).sort(), [slots])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!hora) { toastError('Selecciona una hora disponible.'); return }
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await crearCitaManual(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Cita creada.')
      onSaved()
    })
  }

  const sinDatos = recursosActivos.length === 0 || data.servicios.filter(s => s.activo).length === 0

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Nueva cita</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {sinDatos ? (
              <div className="alert alert-warning">
                Necesitas al menos un servicio activo y un {data.etiquetas.recurso.toLowerCase()} activo. Créalos en sus pestañas. Si solo das un tipo de cita, basta con un único servicio (p.ej. «Consulta», 30 min).
              </div>
            ) : (
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-3">
                  <label>{data.etiquetas.servicio} <span className="required">*</span></label>
                  <select className="input" name="servicio_id" required value={servicioId}
                    onChange={e => { setServicioId(e.target.value); setRecursoId('') }}>
                    <option value="">Selecciona…</option>
                    {data.servicios.filter(s => s.activo).map(s => (
                      <option key={s.servicio_id} value={s.servicio_id}>{s.nombre} ({s.duracion_minutos} min)</option>
                    ))}
                  </select>
                </div>
                <div className="input-group ter-col-span-3">
                  <label>{data.etiquetas.recurso} <span className="required">*</span></label>
                  <select className="input" name="recurso_id" required value={recursoId}
                    onChange={e => setRecursoId(e.target.value)} disabled={!servicioId}>
                    <option value="">Selecciona…</option>
                    {recursosParaServicio.map(r => <option key={r.recurso_id} value={r.recurso_id}>{r.nombre}</option>)}
                  </select>
                </div>
                {recursoId && (
                  <div className="input-group ter-col-full">
                    <label>Próxima disponibilidad</label>
                    {loadingDias ? (
                      <span className="input-hint">Buscando huecos…</span>
                    ) : dias.length === 0 ? (
                      <span className="input-hint input-hint-danger">
                        Sin huecos próximamente. Revisa el horario del {data.etiquetas.recurso.toLowerCase()}.
                      </span>
                    ) : (
                      <div className="cita-dia-chips">
                        {dias.map(d => (
                          <button key={d.fecha} type="button"
                            className={`cita-dia-chip${d.fecha === fecha ? ' cita-dia-chip-active' : ''}`}
                            onClick={() => setFecha(d.fecha)}>
                            {fechaChip(d.fecha)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="input-group ter-col-span-3">
                  <label>Fecha <span className="required">*</span></label>
                  <input className="input" name="fecha" type="date" required min={hoyISO()} value={fecha}
                    onChange={e => setFecha(e.target.value)} />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Hora <span className="required">*</span></label>
                  <select className="input" name="hora" required value={hora}
                    onChange={e => setHora(e.target.value)} disabled={!recursoId || loadingSlots}>
                    <option value="">{loadingSlots ? 'Cargando…' : 'Selecciona…'}</option>
                    {horasLibres.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  {!loadingSlots && recursoId && horasLibres.length === 0 && (
                    <span className="input-hint input-hint-danger">
                      Sin huecos ese día.{dias.length > 0 ? ` Prueba el ${fechaChip(dias[0].fecha)}.` : ` Revisa el horario del ${data.etiquetas.recurso.toLowerCase()}.`}
                    </span>
                  )}
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Cliente <span className="required">*</span></label>
                  <input className="input" name="nombre_cliente" required placeholder="Nombre del cliente" />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Teléfono</label>
                  <input className="input" name="telefono" placeholder="+53 5…" />
                </div>
                <div className="input-group ter-col-full">
                  <label>Notas</label>
                  <input className="input" name="notas" placeholder="Detalles, preferencias…" />
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || sinDatos}>
              {isPending ? <><span className="spinner spinner-sm" /> Creando…</> : 'Crear cita'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: cambiar estado ─────────────────────────────────────────────────────

function CambiarEstadoModal({ cita, nuevoEstado, onConfirm, onClose, isPending }: {
  cita: CitaConDetalle
  nuevoEstado: EstadoReserva
  onConfirm: () => void
  onClose: () => void
  isPending: boolean
}) {
  const mensajes: Record<EstadoReserva, string> = {
    CONFIRMADA: `¿Confirmar la cita de ${cita.nombre_cliente} el ${formatFecha(cita.fecha)}?`,
    RECHAZADA:  `¿Rechazar la cita de ${cita.nombre_cliente} el ${formatFecha(cita.fecha)}?`,
    NO_SHOW:    `¿Marcar como «no asistió» a ${cita.nombre_cliente}?`,
    CANCELADA:  `¿Cancelar la cita de ${cita.nombre_cliente}?`,
    PENDIENTE:  '',
  }
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{ESTADO_LABEL[nuevoEstado]} cita</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body"><p className="modal-body-text">{mensajes[nuevoEstado]}</p></div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className={`btn ${nuevoEstado === 'CONFIRMADA' ? 'btn-primary' : 'btn-danger'}`}
            onClick={onConfirm} disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Procesando…</> : ESTADO_LABEL[nuevoEstado]}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: detalle de cita ─────────────────────────────────────────────────────

function CitaDetalleModal({ cita, onClose, onCambiarEstado }: {
  cita: CitaConDetalle
  onClose: () => void
  onCambiarEstado: (a: EstadoReserva) => void
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Detalle de cita</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="ter-form-grid">
            <div className="input-group ter-col-span-2"><label>Cliente</label><input className="input input-static" readOnly value={cita.nombre_cliente} /></div>
            <div className="input-group ter-col-span-2"><label>Teléfono</label><input className="input input-static" readOnly value={cita.telefono ?? '—'} /></div>
            <div className="input-group ter-col-span-2"><label>Servicio</label><input className="input input-static" readOnly value={cita.servicio_nombre} /></div>
            <div className="input-group ter-col-span-2"><label>Recurso</label><input className="input input-static" readOnly value={cita.recurso_nombre} /></div>
            <div className="input-group ter-col-span-2"><label>Fecha</label><input className="input input-static" readOnly value={formatFecha(cita.fecha)} /></div>
            <div className="input-group ter-col-span-2"><label>Hora</label><input className="input input-static" readOnly value={cita.hora ? `${formatHora(cita.hora)}${cita.hora_fin ? ` – ${formatHora(cita.hora_fin)}` : ''}` : '—'} /></div>
            <div className="input-group ter-col-span-2">
              <label>Estado</label>
              <span className={`badge ${ESTADO_BADGE[cita.estado]}`}>{ESTADO_LABEL[cita.estado]}</span>
            </div>
            <div className="input-group ter-col-span-2"><label>Canal</label><input className="input input-static" readOnly value={CANAL_LABEL[cita.canal] ?? cita.canal} /></div>
            {cita.notas && <div className="input-group ter-col-full"><label>Notas</label><input className="input input-static" readOnly value={cita.notas} /></div>}
          </div>
        </div>
        <div className="modal-footer">
          {cita.estado === 'PENDIENTE' && (
            <>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onCambiarEstado('CONFIRMADA')}><Check size={14} strokeWidth={2} /> Confirmar</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onCambiarEstado('RECHAZADA')}><X size={14} strokeWidth={2} /> Rechazar</button>
            </>
          )}
          {cita.estado === 'CONFIRMADA' && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCambiarEstado('NO_SHOW')}><UserX size={14} strokeWidth={2} /> No asistió</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onCambiarEstado('CANCELADA')}><Trash2 size={14} strokeWidth={2} /> Cancelar</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Confirmación de borrado genérica ───────────────────────────────────────────

function ConfirmEliminar({ titulo, cuerpo, onConfirm, onClose, isPending }: {
  titulo: string; cuerpo: string; onConfirm: () => void; onClose: () => void; isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{titulo}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body"><p className="modal-body-text">{cuerpo}</p></div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Eliminando…</> : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Página: Citas ───────────────────────────────────────────────────────────

export default function CitasView({ data }: { data: CitasPageData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const et = data.etiquetas

  const [activeTab, setActiveTab] = useState<'agenda' | 'recursos' | 'servicios' | 'configuracion'>('agenda')

  const [showNueva,    setShowNueva]    = useState(false)
  const [detalleCita,  setDetalleCita]  = useState<CitaConDetalle | null>(null)
  const [cambioEstado, setCambioEstado] = useState<{ cita: CitaConDetalle; a: EstadoReserva } | null>(null)

  const [showServicio, setShowServicio] = useState(false)
  const [editServicio, setEditServicio] = useState<Servicio | null>(null)
  const [delServicio,  setDelServicio]  = useState<Servicio | null>(null)

  const [showRecurso, setShowRecurso] = useState(false)
  const [editRecurso, setEditRecurso] = useState<Recurso | null>(null)
  const [delRecurso,  setDelRecurso]  = useState<Recurso | null>(null)

  const [search,       setSearch]       = useState('')
  const [filtroDesde,  setFiltroDesde]  = useState(hoyISO())
  const [filtroHasta,  setFiltroHasta]  = useState('')
  const [filtroRecurso, setFiltroRecurso] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')

  const [slugForm, setSlugForm] = useState(data.slug ?? '')
  const [editandoSlug, setEditandoSlug] = useState(false)

  const [botForm, setBotForm] = useState({ token: data.bot_config.token ?? '', nombre: data.bot_config.nombre ?? '' })
  const [confirmAuto, setConfirmAuto] = useState(data.bot_config.confirmacion_automatica)
  const [confirmToggleBot, setConfirmToggleBot] = useState<boolean | null>(null)

  // Host de la plataforma para el enlace público (dinámico, no hardcodeado).
  const [host, setHost] = useState(
    (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  )
  useEffect(() => { setHost(window.location.host) }, [])

  useEffect(() => { setSlugForm(data.slug ?? '') }, [data.slug])
  useEffect(() => {
    setBotForm({ token: data.bot_config.token ?? '', nombre: data.bot_config.nombre ?? '' })
    setConfirmAuto(data.bot_config.confirmacion_automatica)
  }, [data.bot_config])

  const hoy = hoyISO()

  const citas = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.citas.filter(c => {
      if (filtroDesde && c.fecha < filtroDesde) return false
      if (c.fecha > (filtroHasta || filtroDesde)) return false
      if (filtroRecurso && c.recurso_id !== filtroRecurso) return false
      if (filtroEstado && c.estado !== filtroEstado) return false
      if (q) {
        const hay = [c.nombre_cliente, c.telefono, c.notas, c.servicio_nombre, c.recurso_nombre].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data.citas, search, filtroDesde, filtroHasta, filtroRecurso, filtroEstado])

  const { pageItems: citaItems, ...citaPag } = usePagination(citas)

  const pendientesHoy  = data.citas.filter(c => c.fecha === hoy && c.estado === 'PENDIENTE').length
  const confirmadasHoy = data.citas.filter(c => c.fecha === hoy && c.estado === 'CONFIRMADA').length
  const totalHoy       = data.citas.filter(c => c.fecha === hoy).length

  function doCambiarEstado() {
    if (!cambioEstado) return
    startTransition(async () => {
      const res = await cambiarEstadoCita(cambioEstado.cita.reserva_id, cambioEstado.a)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setCambioEstado(null); return }
      toastSuccess(`Cita ${ESTADO_LABEL[cambioEstado.a].toLowerCase()}.`)
      setCambioEstado(null); router.refresh()
    })
  }
  function doEliminarServicio() {
    if (!delServicio) return
    startTransition(async () => {
      const res = await eliminarServicio(delServicio.servicio_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelServicio(null); return }
      toastSuccess('Servicio eliminado.'); setDelServicio(null); router.refresh()
    })
  }
  function doEliminarRecurso() {
    if (!delRecurso) return
    startTransition(async () => {
      const res = await eliminarRecurso(delRecurso.recurso_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelRecurso(null); return }
      toastSuccess(`${et.recurso} eliminado.`); setDelRecurso(null); router.refresh()
    })
  }
  function doImportarRRHH() {
    startTransition(async () => {
      const res = await importarPersonalRRHH()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(res.importados ? `${res.importados} importado${res.importados !== 1 ? 's' : ''} de RRHH.` : 'No hay personal nuevo que importar.')
      router.refresh()
    })
  }
  function handleSlugSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await guardarSlug(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Enlace guardado.'); setEditandoSlug(false); router.refresh()
    })
  }
  function copiarEnlace() {
    if (!data.slug) return
    navigator.clipboard.writeText(`${window.location.origin}/${data.slug}/citas`)
    toastSuccess('Enlace copiado.')
  }
  // La confirmación automática se guarda sola al cambiar el switch (no depende del
  // bot): aplica también a las citas web. Optimista, con reversión si falla.
  function handleConfirmAuto(v: boolean) {
    setConfirmAuto(v)
    startTransition(async () => {
      const res = await guardarConfirmacionCitas(v)
      if (!res.ok) { toastError(res.error ?? 'No se pudo guardar.'); setConfirmAuto(!v); return }
      toastSuccess(v ? 'Las citas se confirmarán automáticamente.' : 'Confirmarás cada cita manualmente.')
      router.refresh()
    })
  }
  function handleBotSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!botForm.token.trim() && !botForm.nombre.trim()) {
      toastError('Introduce al menos el token del bot para guardar la configuración.')
      return
    }
    const fd = new FormData(e.currentTarget)
    fd.set('confirmacion_automatica', String(confirmAuto))
    startTransition(async () => {
      const res = await guardarBotConfigCitas(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Configuración guardada.'); router.refresh()
    })
  }
  function eliminarBot() {
    startTransition(async () => {
      const res = await eliminarBotConfigCitas()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Bot eliminado.'); router.refresh()
    })
  }
  function toggleBot(activo: boolean) {
    startTransition(async () => {
      const res = await toggleActivoBotCitas(activo)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(activo ? 'Bot activado.' : 'Bot desactivado.'); router.refresh()
    })
  }

  function toggleIaBot(activa: boolean) {
    startTransition(async () => {
      const res = await toggleIaBotCitas(activa)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(activa ? 'La IA gestionará el bot.' : 'La IA ya no gestiona el bot.'); router.refresh()
    })
  }

  const servicioNombre = et.servicio
  const servicioPlural = `${et.servicio}s`

  return (
    <div className="view-container">

      <div className="page-header">
        <div>
          <h1 className="page-title">Citas</h1>
          <p className="page-subtitle">
            {activeTab === 'agenda' && totalHoy > 0
              ? `Hoy: ${pendientesHoy} pendientes · ${confirmadasHoy} confirmadas · Total ${totalHoy} citas`
              : `Gestiona las citas de tu negocio.`}
          </p>
        </div>
        <div className="tes-header-actions">
          {activeTab === 'agenda' && (
            <button className="btn btn-primary" onClick={() => setShowNueva(true)}>
              <Plus size={14} strokeWidth={2.5} /> Nueva cita
            </button>
          )}
          {activeTab === 'recursos' && data.rrhh_activo && data.empleados.some(e => !e.ya_importado) && (
            <button className="btn btn-secondary" onClick={doImportarRRHH} disabled={isPending}>
              <Download size={14} strokeWidth={2.5} /> Importar de RRHH
            </button>
          )}
          {activeTab === 'recursos' && (
            <button className="btn btn-primary" onClick={() => { setEditRecurso(null); setShowRecurso(true) }}>
              <Plus size={14} strokeWidth={2.5} /> Nuevo {et.recurso.toLowerCase()}
            </button>
          )}
          {activeTab === 'servicios' && (
            <button className="btn btn-primary" onClick={() => { setEditServicio(null); setShowServicio(true) }}>
              <Plus size={14} strokeWidth={2.5} /> Nuevo {servicioNombre.toLowerCase()}
            </button>
          )}
        </div>
      </div>

      <div className="res-tabs">
        <button className={`res-tab ${activeTab === 'agenda' ? 'active' : ''}`} onClick={() => setActiveTab('agenda')}>Agenda</button>
        <button className={`res-tab ${activeTab === 'recursos' ? 'active' : ''}`} onClick={() => setActiveTab('recursos')}>{et.recurso_pl}</button>
        <button className={`res-tab ${activeTab === 'servicios' ? 'active' : ''}`} onClick={() => setActiveTab('servicios')}>{servicioPlural}</button>
        <button className={`res-tab ${activeTab === 'configuracion' ? 'active' : ''}`} onClick={() => setActiveTab('configuracion')}>Configuración</button>
      </div>

      {/* ── Tab: Agenda ──────────────────────────────────────────────────── */}
      {activeTab === 'agenda' && (
      <>
      <div className="ter-toolbar">
        <div className="ter-search-wrap">
          <Search size={16} strokeWidth={2} />
          <input type="search" className="ter-search" placeholder="Buscar por cliente, servicio…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <input type="date" className="input ter-filter-select" value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)} />
        <input type="date" className="input ter-filter-select" value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)} />
        <select className="input ter-filter-select" value={filtroRecurso} onChange={e => setFiltroRecurso(e.target.value)}>
          <option value="">Todos</option>
          {data.recursos.map(r => <option key={r.recurso_id} value={r.recurso_id}>{r.nombre}</option>)}
        </select>
        <select className="input ter-filter-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="PENDIENTE">Pendientes</option>
          <option value="CONFIRMADA">Confirmadas</option>
          <option value="RECHAZADA">Rechazadas</option>
          <option value="NO_SHOW">No asistieron</option>
          <option value="CANCELADA">Canceladas</option>
        </select>
      </div>

      <div className="card card-table">
        {citas.length === 0 ? (
          <div className="mon-empty">
            <CalendarDays size={40} strokeWidth={1} opacity={0.2} />
            <p>{data.citas.length === 0
              ? 'Aún no hay citas. Crea la primera o comparte tu enlace de reservas.'
              : 'No hay citas para los filtros seleccionados.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th><th>Hora</th><th>{servicioNombre}</th><th>{et.recurso}</th>
                  <th>Cliente</th><th>Estado</th><th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {citaItems.map(c => (
                  <tr key={c.reserva_id} className="table-row-clickable" onClick={() => setDetalleCita(c)}>
                    <td data-label="Fecha"><strong>{formatFecha(c.fecha)}</strong></td>
                    <td data-label="Hora" className="tes-nowrap">
                      {c.hora ? `${formatHora(c.hora)}${c.hora_fin ? ` – ${formatHora(c.hora_fin)}` : ''}` : '—'}
                    </td>
                    <td data-label={servicioNombre}>{c.servicio_nombre}</td>
                    <td data-label={et.recurso}>{c.recurso_nombre}</td>
                    <td data-label="Cliente">
                      <strong>{c.nombre_cliente}</strong>
                      {c.telefono && <div className="text-sm-muted">{c.telefono}</div>}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge ${ESTADO_BADGE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span>
                      <div className="text-xs-muted">{CANAL_LABEL[c.canal] ?? c.canal}</div>
                    </td>
                    <td className="col-actions">
                      {(c.estado === 'PENDIENTE' || c.estado === 'CONFIRMADA') && (
                        <RowActions>
                          {c.estado === 'PENDIENTE' && (
                            <>
                              <button className="row-actions-item"
                                onClick={() => setCambioEstado({ cita: c, a: 'CONFIRMADA' })} disabled={isPending}><Check size={15} strokeWidth={2} /> Confirmar</button>
                              <button className="row-actions-item row-actions-item-danger"
                                onClick={() => setCambioEstado({ cita: c, a: 'RECHAZADA' })} disabled={isPending}><X size={15} strokeWidth={2} /> Rechazar</button>
                            </>
                          )}
                          {c.estado === 'CONFIRMADA' && (
                            <button className="row-actions-item row-actions-item-danger"
                              onClick={() => setCambioEstado({ cita: c, a: 'CANCELADA' })} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Cancelar cita</button>
                          )}
                        </RowActions>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...citaPag} label="cita" />
      </div>
      </>
      )}

      {/* ── Tab: Recursos / profesionales ────────────────────────────────── */}
      {activeTab === 'recursos' && (
      <div className="card card-table">
        {data.recursos.length === 0 ? (
          <div className="mon-empty">
            <CalendarDays size={36} strokeWidth={1} opacity={0.2} />
            <p>Aún no hay {et.recurso_pl.toLowerCase()}. Crea al menos uno para empezar a recibir citas.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Nombre</th><th>Tipo</th><th>{servicioPlural}</th><th>Horario</th><th>Estado</th><th className="col-actions"></th></tr>
              </thead>
              <tbody>
                {data.recursos.map(r => (
                  <tr key={r.recurso_id} className="table-row-clickable" onClick={() => { setEditRecurso(r); setShowRecurso(true) }}>
                    <td data-label="Nombre"><strong>{r.nombre}</strong></td>
                    <td data-label="Tipo" className="text-sm-muted">{r.tipo ?? '—'}</td>
                    <td data-label={servicioPlural} className="text-sm-muted">{r.servicio_ids.length === 0 ? 'Todos' : `${r.servicio_ids.length}`}</td>
                    <td data-label="Horario" className="text-sm-muted">
                      {r.horarios.length === 0 ? <span className="text-xs-muted">Sin horario</span>
                        : r.horarios.map(h => DIA_LABEL[h.dia_semana]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
                    </td>
                    <td data-label="Estado"><span className={`badge ${r.activo ? 'badge-success' : 'badge-neutral'}`}>{r.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => { setEditRecurso(r); setShowRecurso(true) }}><Pencil size={15} strokeWidth={2} /> Editar</button>
                        <button className="row-actions-item row-actions-item-danger" onClick={() => setDelRecurso(r)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ── Tab: Servicios ───────────────────────────────────────────────── */}
      {activeTab === 'servicios' && (
      <div className="card card-table">
        {data.servicios.length === 0 ? (
          <div className="mon-empty">
            <CalendarDays size={36} strokeWidth={1} opacity={0.2} />
            <p>Aún no hay {servicioPlural.toLowerCase()}. Crea los que ofreces (con su duración) para poder agendar. Si solo das un tipo de cita, créalo igualmente como un único servicio (p.ej. «Consulta», 30 min).</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Nombre</th><th className="col-num">Duración</th><th className="col-num">Precio</th><th>Estado</th><th className="col-actions"></th></tr>
              </thead>
              <tbody>
                {data.servicios.map(s => (
                  <tr key={s.servicio_id} className="table-row-clickable" onClick={() => { setEditServicio(s); setShowServicio(true) }}>
                    <td data-label="Nombre"><strong>{s.nombre}</strong></td>
                    <td data-label="Duración" className="col-num tes-monto-cell">{s.duracion_minutos} min</td>
                    <td data-label="Precio" className="col-num tes-monto-cell cita-precio">{formatPrecio(s.precio)}</td>
                    <td data-label="Estado"><span className={`badge ${s.activo ? 'badge-success' : 'badge-neutral'}`}>{s.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => { setEditServicio(s); setShowServicio(true) }}><Pencil size={15} strokeWidth={2} /> Editar</button>
                        <button className="row-actions-item row-actions-item-danger" onClick={() => setDelServicio(s)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ── Tab: Configuración ───────────────────────────────────────────── */}
      {activeTab === 'configuracion' && (
      <>

      {/* Automatización: banner IA (si contratado) + confirmación */}
      {data.tieneIa && (
        <IaBotBanner entidad="citas" activa={data.bot_config.ia_activa}
          isPending={isPending} onToggle={toggleIaBot} />
      )}

      <div className="res-conf-item">
        <div className="res-conf-item-text">
          <span className="res-conf-item-title">Confirmación automática</span>
          <span className="input-hint">
            {data.tieneIa && data.bot_config.ia_activa
              ? (confirmAuto
                  ? 'La IA confirmará automáticamente las citas que cumplan las reglas.'
                  : 'La IA creará las citas pendientes para que tú las confirmes.')
              : (confirmAuto
                  ? 'Las citas se confirman solas al crearse; el cliente lo ve al instante.'
                  : 'Tú confirmas cada cita; el cliente queda pendiente hasta que la revises.')}
          </span>
        </div>
        <label className="switch">
          <input type="checkbox" checked={confirmAuto} disabled={isPending}
            onChange={e => handleConfirmAuto(e.target.checked)} aria-label="Confirmar citas automáticamente" />
          <span className="switch-track" aria-hidden="true" />
        </label>
      </div>

      {/* Enlace público */}
      <div className="card res-section">
        <div className="card-header"><h2 className="card-title">Enlace de citas</h2></div>
        {data.slug && !editandoSlug ? (
          <div className="table-wrapper">
            <table className="table">
              <thead><tr><th>Enlace</th><th className="col-actions"></th></tr></thead>
              <tbody>
                <tr>
                  <td data-label="Enlace">
                    <strong>{host}/{data.slug}/citas</strong>
                    <div className="text-xs-muted">Compártelo para que tus clientes pidan cita en línea.</div>
                  </td>
                  <td className="col-actions">
                    <RowActions>
                      <button className="row-actions-item" onClick={copiarEnlace} disabled={isPending}><Copy size={15} strokeWidth={2} /> Copiar enlace</button>
                      <button className="row-actions-item" onClick={() => setEditandoSlug(true)} disabled={isPending}><Pencil size={15} strokeWidth={2} /> Editar enlace</button>
                    </RowActions>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <form onSubmit={handleSlugSubmit}>
            <div className="ter-form-grid res-conf-pad-top">
              <div className="input-group ter-col-full">
                <label>{data.slug ? 'Modificar tu enlace' : 'Tu dirección web para compartir'}</label>
                <div className="res-slug-wrap">
                  <span className="res-slug-prefix">{host}/</span>
                  <input className="input" name="slug" placeholder="tu-negocio" value={slugForm} onChange={e => setSlugForm(e.target.value)} />
                  <span className="res-slug-suffix">/citas</span>
                </div>
                <span className="input-hint">Solo letras, números y guiones.</span>
              </div>
            </div>
            <div className="res-form-submit res-actions-row">
              {data.slug && <button type="button" className="btn btn-secondary" onClick={() => { setEditandoSlug(false); setSlugForm(data.slug ?? '') }}>Cancelar</button>}
              <button type="submit" className="btn btn-primary" disabled={isPending}>
                {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : data.slug ? 'Modificar enlace' : 'Guardar enlace'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Bot de Telegram (independiente del de Reservas) */}
      <div className="card res-section">
        <div className="card-header"><h2 className="card-title">Bot de Telegram de citas</h2></div>

        {data.bot_config.token ? (
          <>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr><th>Nombre</th><th>Token</th><th>Estado</th><th className="col-actions"></th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td data-label="Nombre"><strong>{data.bot_config.nombre ?? '—'}</strong></td>
                    <td data-label="Token" className="text-sm-muted">{data.bot_config.token ? `${data.bot_config.token.substring(0, 10)}…` : '—'}</td>
                    <td data-label="Estado">
                      <span className={`badge ${data.bot_config.activo ? 'badge-success' : 'badge-neutral'}`}>
                        {data.bot_config.activo ? 'Activo' : 'Inactivo'}
                      </span>
                      {data.bot_config.webhook_registrado && <div className="text-xs-muted">Webhook registrado</div>}
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item"
                          onClick={() => setConfirmToggleBot(!data.bot_config.activo)} disabled={isPending}>
                          {data.bot_config.activo ? <PowerOff size={15} strokeWidth={2} /> : <Power size={15} strokeWidth={2} />} {data.bot_config.activo ? 'Desactivar bot' : 'Activar bot'}
                        </button>
                        <button className="row-actions-item row-actions-item-danger"
                          onClick={eliminarBot} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar bot</button>
                      </RowActions>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {!data.bot_config.notificar_owner_chat_id ? (
              <div className="info-box">
                <strong className="info-box-title">Vincula tu chat para recibir avisos</strong>
                <span className="text-xs-muted">
                  Abre tu bot en Telegram y envía <code>/start {data.bot_config.codigo_vinculo ?? '—'}</code>.
                  Recibirás ahí cada cita nueva, con botones para confirmarla o rechazarla.
                </span>
              </div>
            ) : (
              <div className="info-box">
                <span className="text-xs-muted">✓ Chat del dueño vinculado · recibes los avisos de citas nuevas.</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="info-box">
              <strong className="info-box-title">Cómo configurarlo</strong>
              <span className="text-xs-muted">
                Este bot es independiente del de Reservas. Abre <strong>@BotFather</strong> en Telegram, crea un bot con <code>/newbot</code> y pega aquí el token.
                Tras guardar verás un código para vincular tu chat y recibir los avisos de citas.
              </span>
            </div>

            <form onSubmit={handleBotSubmit}>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-3">
                  <label>Nombre del bot</label>
                  <input className="input" name="nombre" placeholder="MiPeluqueriaBot"
                    value={botForm.nombre} onChange={e => setBotForm({ ...botForm, nombre: e.target.value })} />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Token del bot</label>
                  <input className="input" name="token" placeholder="1234567890:ABCdef..."
                    value={botForm.token} onChange={e => setBotForm({ ...botForm, token: e.target.value })} />
                </div>
              </div>
              <div className="res-form-submit">
                <button type="submit" className="btn btn-primary" disabled={isPending}>
                  {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar configuración'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {/* Reglas de reserva (antelación/ventana; compartidas con Reservas) */}
      <ReglasReservaSection reglas={data.reglas} iaActiva={data.tieneIa && data.bot_config.ia_activa} />

      {/* Cierres y festivos */}
      <CierresSection cierres={data.cierres} iaActiva={data.tieneIa && data.bot_config.ia_activa} />

      </>
      )}

      {/* Modales */}
      {showNueva && <NuevaCitaModal data={data} onClose={() => setShowNueva(false)} onSaved={() => { setShowNueva(false); router.refresh() }} />}
      {detalleCita && (
        <CitaDetalleModal cita={detalleCita} onClose={() => setDetalleCita(null)}
          onCambiarEstado={a => { const c = detalleCita; setDetalleCita(null); setCambioEstado({ cita: c, a }) }} />
      )}
      {cambioEstado && (
        <CambiarEstadoModal cita={cambioEstado.cita} nuevoEstado={cambioEstado.a}
          onConfirm={doCambiarEstado} onClose={() => setCambioEstado(null)} isPending={isPending} />
      )}
      {showServicio && (
        <ServicioModal servicio={editServicio} etiqueta={servicioNombre}
          onClose={() => { setShowServicio(false); setEditServicio(null) }}
          onSaved={() => { setShowServicio(false); setEditServicio(null); router.refresh() }} />
      )}
      {delServicio && (
        <ConfirmEliminar titulo={`Eliminar ${servicioNombre.toLowerCase()}`}
          cuerpo={`¿Eliminar «${delServicio.nombre}»? Si tiene citas futuras, la acción se bloqueará.`}
          onConfirm={doEliminarServicio} onClose={() => setDelServicio(null)} isPending={isPending} />
      )}
      {showRecurso && (
        <RecursoModal recurso={editRecurso} servicios={data.servicios.filter(s => s.activo)}
          etiquetaRec={et.recurso} etiquetaSrv={et.servicio}
          onClose={() => { setShowRecurso(false); setEditRecurso(null) }}
          onSaved={() => { setShowRecurso(false); setEditRecurso(null); router.refresh() }} />
      )}
      {delRecurso && (
        <ConfirmEliminar titulo={`Eliminar ${et.recurso.toLowerCase()}`}
          cuerpo={`¿Eliminar «${delRecurso.nombre}»? Si tiene citas futuras, la acción se bloqueará.`}
          onConfirm={doEliminarRecurso} onClose={() => setDelRecurso(null)} isPending={isPending} />
      )}
      {confirmToggleBot !== null && (
        <div className="modal-backdrop open">
          <div className="modal modal-sm" role="dialog" aria-modal>
            <div className="modal-header">
              <h2 className="modal-title">{confirmToggleBot ? 'Activar bot' : 'Desactivar bot'}</h2>
              <button type="button" className="modal-close" onClick={() => setConfirmToggleBot(null)}><X size={16} strokeWidth={2} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-body-text">
                {confirmToggleBot
                  ? '¿Activar el bot de Telegram de citas? Los clientes podrán usarlo.'
                  : '¿Desactivar el bot de Telegram de citas? Dejará de responder a los clientes.'}
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmToggleBot(null)}>Cancelar</button>
              <button type="button" className={`btn ${confirmToggleBot ? 'btn-primary' : 'btn-danger'}`}
                onClick={() => { toggleBot(confirmToggleBot); setConfirmToggleBot(null) }} disabled={isPending}>
                {confirmToggleBot ? 'Activar' : 'Desactivar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
