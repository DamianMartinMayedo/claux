'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter }                        from 'next/navigation'
import {
  crearReserva,
  modificarReserva,
  cambiarEstadoReserva,
  guardarFranja,
  eliminarFranja,
  guardarBotConfig,
  eliminarBotConfig,
  toggleActivoBot,
  guardarSlug,
  obtenerDisponibilidadPublica,
  type ReservaFranja,
  type ReservaConFranja,
  type ReservaPageData,
} from '@/app/actions/portal/reservas'
import { type EstadoReserva } from '@/lib/reservas/estado'
import { Calendar, Check, Copy, Pencil, Plus, Power, PowerOff, Search, Trash2, UserX, X } from 'lucide-react'

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
const DIA_LABEL: Record<number, string> = {
  1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom',
}
const MEDIAS_HORAS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

function horasEnRango(inicio: string | null, fin: string | null, fecha?: string): string[] {
  const base = (!inicio || !fin) ? MEDIAS_HORAS : MEDIAS_HORAS.filter(h => h >= inicio && h < fin)
  if (fecha === hoyISO()) {
    const ahora = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`
    return base.filter(h => h > ahora)
  }
  return base
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hoyISO(): string { return new Date().toISOString().split('T')[0] }
function formatFecha(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}
function formatHora(h: string | null): string {
  if (!h) return '—'
  return h.substring(0, 5)
}

// ── Modal: nueva reserva ──────────────────────────────────────────────────────

function NuevaReservaModal({
  data, onClose, onSaved,
}: {
  data:    ReservaPageData
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const franjasActivas = data.franjas.filter(f => f.activa)
  const [dispFranja, setDispFranja] = useState('')
  const [dispFecha,  setDispFecha]  = useState(hoyISO())
  const [dispHora,   setDispHora]   = useState('')
  const [dispInfo,   setDispInfo]   = useState<{ disponibles: number; ocupado: number; capacidad: number } | null>(null)
  const clientId = data.reservas[0]?.client_id ?? ''

  function chequearDisponibilidad(franja: string, fecha: string, hora: string) {
    if (!franja || !fecha || !hora) { setDispInfo(null); return }
    obtenerDisponibilidadPublica(clientId, franja, fecha, hora).then(r => {
      const f = data.franjas.find(x => x.franja_id === franja)
      setDispInfo({ disponibles: r.disponibles, ocupado: (f?.capacidad ?? 0) - r.disponibles, capacidad: f?.capacidad ?? 0 })
    }).catch(() => setDispInfo(null))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await crearReserva(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Reserva creada.')
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Nueva reserva</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {franjasActivas.length === 0 ? (
              <div className="alert alert-warning">No hay turnos activos. Ve a la pestaña Turnos y crea al menos uno.</div>
            ) : (
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-3">
                  <label>Turno <span className="required">*</span></label>
                  <select className="input" name="franja_id" required
                    onChange={e => { setDispFranja(e.target.value); chequearDisponibilidad(e.target.value, dispFecha, dispHora) }}>
                    <option value="">Selecciona…</option>
                    {franjasActivas.map(f => (
                      <option key={f.franja_id} value={f.franja_id}>
                        {f.nombre}{f.hora_inicio ? ` (${formatHora(f.hora_inicio)}–${formatHora(f.hora_fin)})` : ''} — cap. {f.capacidad}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Personas <span className="required">*</span></label>
                  <input className="input" name="personas" type="number" min="1" required defaultValue="1" />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Fecha <span className="required">*</span></label>
                  <input className="input" name="fecha" type="date" required min={hoyISO()} defaultValue={hoyISO()}
                    onChange={e => { setDispFecha(e.target.value); chequearDisponibilidad(dispFranja, e.target.value, dispHora) }} />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Hora</label>
                  <select className="input" name="hora"
                    onChange={e => { setDispHora(e.target.value); chequearDisponibilidad(dispFranja, dispFecha, e.target.value) }}>
                    <option value="">Selecciona…</option>
                    {horasEnRango(
                      data.franjas.find(f => f.franja_id === dispFranja)?.hora_inicio ?? null,
                      data.franjas.find(f => f.franja_id === dispFranja)?.hora_fin ?? null,
                      dispFecha || hoyISO(),
                    ).map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  {dispInfo && (
                    <span className={`input-hint ${dispInfo.disponibles === 0 ? 'input-hint-danger' : ''}`}>
                      {dispInfo.disponibles === 0
                        ? 'Lleno a esta hora.'
                        : `${dispInfo.disponibles} disponible${dispInfo.disponibles !== 1 ? 's' : ''} de ${dispInfo.capacidad}`}
                    </span>
                  )}
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Nombre <span className="required">*</span></label>
                  <input className="input" name="nombre_cliente" required placeholder="Cliente" autoFocus />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Teléfono</label>
                  <input className="input" name="telefono" placeholder="+53 5…" />
                </div>
                <div className="input-group ter-col-full">
                  <label>Notas</label>
                  <input className="input" name="notas" placeholder="Alergias, ocasión especial…" />
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || franjasActivas.length === 0}>
              {isPending ? <><span className="spinner spinner-sm" /> Creando…</> : 'Crear reserva'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: cambiar estado ─────────────────────────────────────────────────────

function CambiarEstadoModal({
  reserva, nuevoEstado, onConfirm, onClose, isPending,
}: {
  reserva:     ReservaConFranja
  nuevoEstado: EstadoReserva
  onConfirm:   () => void
  onClose:     () => void
  isPending:   boolean
}) {
  const mensajes: Record<EstadoReserva, string> = {
    CONFIRMADA: `¿Confirmar la reserva de ${reserva.nombre_cliente} para el ${formatFecha(reserva.fecha)}?`,
    RECHAZADA:  `¿Rechazar la reserva de ${reserva.nombre_cliente} para el ${formatFecha(reserva.fecha)}?`,
    NO_SHOW:    `¿Marcar como «no asistió» a ${reserva.nombre_cliente}?`,
    CANCELADA:  `¿Cancelar la reserva de ${reserva.nombre_cliente}?`,
    PENDIENTE:  '',
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{ESTADO_LABEL[nuevoEstado]} reserva</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">{mensajes[nuevoEstado]}</p>
        </div>
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

// ── Modal: detalle de reserva ──────────────────────────────────────────────────

function ReservaDetalleModal({
  reserva, onClose, onCambiarEstado, onEditar,
}: {
  reserva:         ReservaConFranja
  onClose:         () => void
  onCambiarEstado: (a: EstadoReserva) => void
  onEditar:        () => void
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Detalle de reserva</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="ter-form-grid">
            <div className="input-group ter-col-span-2">
              <label>Cliente</label>
              <input className="input input-static" readOnly value={reserva.nombre_cliente} />
            </div>
            <div className="input-group ter-col-span-2">
              <label>Teléfono</label>
              <input className="input input-static" readOnly value={reserva.telefono ?? '—'} />
            </div>
            <div className="input-group ter-col-span-2">
              <label>Turno</label>
              <input className="input input-static" readOnly value={reserva.franja_nombre} />
            </div>
            <div className="input-group ter-col-span-2">
              <label>Fecha</label>
              <input className="input input-static" readOnly value={formatFecha(reserva.fecha)} />
            </div>
            <div className="input-group ter-col-span-2">
              <label>Hora</label>
              <input className="input input-static" readOnly value={reserva.hora ? `${reserva.hora.substring(0, 5)}${reserva.hora_fin ? ` – ${reserva.hora_fin.substring(0, 5)}` : ''}` : '—'} />
            </div>
            <div className="input-group ter-col-span-2">
              <label>Personas</label>
              <input className="input input-static" readOnly value={String(reserva.personas)} />
            </div>
            <div className="input-group ter-col-span-2">
              <label>Estado</label>
              <span className={`badge ${ESTADO_BADGE[reserva.estado]}`}>
                {ESTADO_LABEL[reserva.estado]}
              </span>
            </div>
            <div className="input-group ter-col-span-2">
              <label>Canal</label>
              <input className="input input-static" readOnly value={CANAL_LABEL[reserva.canal] ?? reserva.canal} />
            </div>
            {reserva.notas && (
              <div className="input-group ter-col-full">
                <label>Notas</label>
                <input className="input input-static" readOnly value={reserva.notas} />
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onEditar}>
            <Pencil size={14} strokeWidth={2} /> Editar
          </button>
          {reserva.estado === 'PENDIENTE' && (
            <>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onCambiarEstado('CONFIRMADA')}>
                <Check size={14} strokeWidth={2} /> Confirmar
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onCambiarEstado('RECHAZADA')}>
                <X size={14} strokeWidth={2} /> Rechazar
              </button>
            </>
          )}
          {reserva.estado === 'CONFIRMADA' && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCambiarEstado('NO_SHOW')}>
                <UserX size={14} strokeWidth={2} /> No asistió
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onCambiarEstado('CANCELADA')}>
                <Trash2 size={14} strokeWidth={2} /> Cancelar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal: editar reserva ──────────────────────────────────────────────────────

function EditarReservaModal({
  reserva, data, onClose, onSaved,
}: {
  reserva: ReservaConFranja
  data:    ReservaPageData
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const franjasActivas = data.franjas.filter(f => f.activa)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await modificarReserva(reserva.reserva_id, fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Reserva actualizada.')
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Editar reserva</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="ter-form-grid">
              <div className="input-group ter-col-span-3">
                <label>Turno <span className="required">*</span></label>
                <select className="input" name="franja_id" required defaultValue={reserva.franja_id}>
                  {franjasActivas.map(f => (
                    <option key={f.franja_id} value={f.franja_id}>
                      {f.nombre}{f.hora_inicio ? ` (${formatHora(f.hora_inicio)}–${formatHora(f.hora_fin)})` : ''} — cap. {f.capacidad}
                    </option>
                  ))}
                </select>
              </div>
              <div className="input-group ter-col-span-3">
                <label>Personas <span className="required">*</span></label>
                <input className="input" name="personas" type="number" min="1" required defaultValue={reserva.personas} />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Fecha <span className="required">*</span></label>
                <input className="input" name="fecha" type="date" required defaultValue={reserva.fecha} />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Hora</label>
                <select className="input" name="hora" defaultValue={reserva.hora?.substring(0, 5) ?? ''}>
                  <option value="">Selecciona…</option>
                  {horasEnRango(
                    data.franjas.find(f => f.franja_id === reserva.franja_id)?.hora_inicio ?? null,
                    data.franjas.find(f => f.franja_id === reserva.franja_id)?.hora_fin ?? null,
                    reserva.fecha,
                  ).map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className="input-group ter-col-span-3">
                <label>Nombre <span className="required">*</span></label>
                <input className="input" name="nombre_cliente" required defaultValue={reserva.nombre_cliente} autoFocus />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Teléfono</label>
                <input className="input" name="telefono" defaultValue={reserva.telefono ?? ''} placeholder="+53 5…" />
              </div>
              <div className="input-group ter-col-full">
                <label>Notas</label>
                <input className="input" name="notas" defaultValue={reserva.notas ?? ''} placeholder="Alergias, ocasión especial…" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: guardar turno ──────────────────────────────────────────────────────

function FranjaModal({
  franja, onClose, onSaved,
}: {
  franja:  ReservaFranja | null
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!franja

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (franja) fd.set('franja_id', franja.franja_id)
    startTransition(async () => {
      const res = await guardarFranja(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(franja ? 'Turno actualizado.' : 'Turno creado.')
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
          <div className="modal-body">
            <div className="ter-form-grid">
              <div className="input-group ter-col-span-3">
                <label>Nombre <span className="required">*</span></label>
                <input className="input" name="nombre" required autoFocus={!isEdit}
                  defaultValue={franja?.nombre ?? ''} placeholder="Almuerzo, Comida…" />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Capacidad <span className="required">*</span></label>
                <input className="input" name="capacidad" type="number" min="1" required
                  defaultValue={franja?.capacidad ?? 1} />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Duración (min) <span className="required">*</span></label>
                <input className="input" name="duracion_minutos" type="number" min="15" required
                  defaultValue={franja?.duracion_minutos ?? 60} />
                <span className="input-hint">Tiempo que ocupa cada reserva (mín. 15 min).</span>
              </div>
              <div className="input-group ter-col-span-3">
                <label>Hora inicio <span className="required">*</span></label>
                <select className="input" name="hora_inicio" required defaultValue={franja?.hora_inicio ?? ''}>
                  <option value="">Selecciona…</option>
                  {MEDIAS_HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className="input-group ter-col-span-3">
                <label>Hora fin <span className="required">*</span></label>
                <select className="input" name="hora_fin" required defaultValue={franja?.hora_fin ?? ''}>
                  <option value="">Selecciona…</option>
                  {MEDIAS_HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className="input-group ter-col-full">
                <label>Días</label>
                <div className="res-dias-row">
                  {[1, 2, 3, 4, 5, 6, 7].map(d => (
                    <label key={d} className="res-dias-item">
                      <input type="checkbox" name="dias_semana" value={String(d)}
                        defaultChecked={franja?.dias_semana ? franja.dias_semana.includes(d) : true} />
                      {DIA_LABEL[d]}
                    </label>
                  ))}
                </div>
                <span className="input-hint">Sin selección = todos los días.</span>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : isEdit ? 'Guardar cambios' : 'Crear turno'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Confirmación eliminar turno ────────────────────────────────────────────────

function ConfirmEliminarFranja({
  franja, onConfirm, onClose, isPending,
}: {
  franja:    ReservaFranja
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Eliminar turno</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">¿Eliminar el turno <strong>{franja.nombre}</strong>? No se puede deshacer. Si hay reservas futuras, la acción se bloqueará.</p>
        </div>
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

// ── Página: Reservas ──────────────────────────────────────────────────────────

export default function ReservasView({ data }: { data: ReservaPageData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [showNueva,      setShowNueva]      = useState(false)
  const [cambioEstado,   setCambioEstado]   = useState<{ reserva: ReservaConFranja; a: EstadoReserva } | null>(null)
  const [showFranja,     setShowFranja]     = useState(false)
  const [editFranja,     setEditFranja]     = useState<ReservaFranja | null>(null)
  const [delFranja,      setDelFranja]      = useState<ReservaFranja | null>(null)
  const [activeTab,      setActiveTab]      = useState<'reservas' | 'turnos' | 'configuracion'>('reservas')
  const [detalleReserva, setDetalleReserva] = useState<ReservaConFranja | null>(null)
  const [editarReserva,  setEditarReserva]  = useState<ReservaConFranja | null>(null)
  const [confirmToggleBot, setConfirmToggleBot] = useState<boolean | null>(null)

  const [search,         setSearch]         = useState('')
  const [filtroDesde,   setFiltroDesde]   = useState(hoyISO())
  const [filtroHasta,   setFiltroHasta]   = useState('')
  const [filtroFranja,  setFiltroFranja]   = useState('')
  const [filtroEstado,  setFiltroEstado]   = useState('')

  const [slugForm, setSlugForm] = useState(data.slug ?? '')
  const [editandoSlug, setEditandoSlug] = useState(false)
  const [botForm, setBotForm] = useState({
    token:  data.bot_config.token ?? '',
    nombre: data.bot_config.nombre ?? '',
  })
  const [confirmAuto, setConfirmAuto] = useState(data.bot_config.confirmacion_automatica)

  // Sincronizar botForm cuando data cambia (ej: tras eliminar bot)
  useEffect(() => {
    setBotForm({
      token:  data.bot_config.token ?? '',
      nombre: data.bot_config.nombre ?? '',
    })
    setConfirmAuto(data.bot_config.confirmacion_automatica)
    setSlugForm(data.slug ?? '')
  }, [data.bot_config, data.slug])

  const hoy = hoyISO()

  const reservas = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.reservas.filter(r => {
      if (filtroDesde  && r.fecha   < filtroDesde)   return false
      if (r.fecha > (filtroHasta || filtroDesde))       return false
      if (filtroFranja && r.franja_id !== filtroFranja) return false
      if (filtroEstado && r.estado  !== filtroEstado) return false
      if (q) {
        const hay = [r.nombre_cliente, r.telefono, r.notas, r.franja_nombre]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data.reservas, search, filtroDesde, filtroHasta, filtroFranja, filtroEstado])

  const pendientesHoy = data.reservas.filter(r => r.fecha === hoy && r.estado === 'PENDIENTE').length
  const confirmadasHoy = data.reservas.filter(r => r.fecha === hoy && r.estado === 'CONFIRMADA').length
  const totalHoy = data.reservas.filter(r => r.fecha === hoy).length

  function onSaved() { setShowNueva(false); router.refresh() }

  function doCambiarEstado() {
    if (!cambioEstado) return
    startTransition(async () => {
      const res = await cambiarEstadoReserva(cambioEstado.reserva.reserva_id, cambioEstado.a)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setCambioEstado(null); return }
      toastSuccess(`Reserva ${ESTADO_LABEL[cambioEstado.a].toLowerCase()}.`)
      setCambioEstado(null); router.refresh()
    })
  }

  function openNuevaFranja()  { setEditFranja(null); setShowFranja(true) }
  function openEditFranja(f: ReservaFranja) { setEditFranja(f); setShowFranja(true) }
  function onFranjaSaved() { setShowFranja(false); setEditFranja(null); router.refresh() }

  function doEliminarFranja() {
    if (!delFranja) return
    startTransition(async () => {
      const res = await eliminarFranja(delFranja.franja_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelFranja(null); return }
      toastSuccess('Turno eliminado.')
      setDelFranja(null); router.refresh()
    })
  }

  function handleSlugSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await guardarSlug(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Enlace guardado.')
      setEditandoSlug(false)
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
      const res = await guardarBotConfig(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Configuración guardada.')
      router.refresh()
    })
  }

  function copiarEnlace() {
    if (!data.slug) return
    navigator.clipboard.writeText(`claux.app/${data.slug}/reservar`)
  }

  function eliminarBot() {
    startTransition(async () => {
      const res = await eliminarBotConfig()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Bot eliminado.')
      router.refresh()
    })
  }

  function toggleBot(activo: boolean) {
    startTransition(async () => {
      const res = await toggleActivoBot(activo)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(activo ? 'Bot activado.' : 'Bot desactivado.')
      router.refresh()
    })
  }

  return (
    <div className="view-container">

      <div className="page-header">
        <div>
          <h1 className="page-title">Reservas</h1>
          <p className="page-subtitle">
            {activeTab === 'reservas' && totalHoy > 0
              ? `Hoy: ${pendientesHoy} pendientes · ${confirmadasHoy} confirmadas · Total ${totalHoy}`
              : 'Gestiona las reservas de tus clientes.'}
          </p>
        </div>
        <div className="tes-header-actions">
          {activeTab === 'reservas' && (
            <button className="btn btn-primary" onClick={() => setShowNueva(true)}>
              <Plus size={14} strokeWidth={2.5} /> Nueva reserva
            </button>
          )}
        </div>
      </div>

      <div className="res-tabs">
        <button className={`res-tab ${activeTab === 'reservas' ? 'active' : ''}`}
          onClick={() => setActiveTab('reservas')}>Reservas</button>
        <button className={`res-tab ${activeTab === 'turnos' ? 'active' : ''}`}
          onClick={() => setActiveTab('turnos')}>Turnos</button>
        <button className={`res-tab ${activeTab === 'configuracion' ? 'active' : ''}`}
          onClick={() => setActiveTab('configuracion')}>Configuración</button>
      </div>

      {/* ── Tab: Reservas ────────────────────────────────────────────────── */}
      {activeTab === 'reservas' && (
      <>

      <div className="ter-toolbar">
        <div className="ter-search-wrap">
          <Search size={16} strokeWidth={2} />
          <input type="search" className="ter-search" placeholder="Buscar por cliente, teléfono, notas…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <input type="date" className="input ter-filter-select" value={filtroDesde}
          onChange={e => setFiltroDesde(e.target.value)} />
        <input type="date" className="input ter-filter-select" value={filtroHasta}
          onChange={e => setFiltroHasta(e.target.value)} placeholder="hasta" />
        <select className="input ter-filter-select" value={filtroFranja} onChange={e => setFiltroFranja(e.target.value)}>
          <option value="">Todos los turnos</option>
          {data.franjas.map(f => <option key={f.franja_id} value={f.franja_id}>{f.nombre}</option>)}
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
        {reservas.length === 0 ? (
          <div className="mon-empty">
            <Calendar size={40} strokeWidth={1} opacity={0.2} />
            <p>{data.reservas.length === 0
              ? 'Aún no hay reservas. Crea la primera o comparte el enlace de reservas con tus clientes.'
              : 'No hay reservas para los filtros seleccionados.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Turno</th>
                  <th>Cliente</th>
                  <th className="tes-col-monto">Pers.</th>
                  <th>Estado</th>
                  <th className="alm-col-act"></th>
                </tr>
              </thead>
              <tbody>
                {reservas.map(r => (
                  <tr key={r.reserva_id} className="table-row-clickable"
                    onClick={() => setDetalleReserva(r)}>
                    <td><strong>{formatFecha(r.fecha)}</strong></td>
                    <td className="tes-col-monto tes-monto-cell">
                      {r.hora ? `${r.hora.substring(0, 5)}${r.hora_fin ? ` – ${r.hora_fin.substring(0, 5)}` : ''}` : '—'}
                    </td>
                    <td>
                      {r.franja_nombre}
                      {r.franja_hora_inicio && <div className="text-sm-muted">{formatHora(r.franja_hora_inicio)} – {formatHora(r.franja_hora_fin)}</div>}
                    </td>
                    <td>
                      <strong>{r.nombre_cliente}</strong>
                      {r.telefono && <div className="text-sm-muted">{r.telefono}</div>}
                      {r.notas && <div className="text-sm-muted">{r.notas}</div>}
                    </td>
                    <td className="tes-col-monto tes-monto-cell">{r.personas}</td>
                    <td>
                      <span className={`badge ${ESTADO_BADGE[r.estado]}`}>{ESTADO_LABEL[r.estado]}</span>
                      <div className="text-xs-muted">{CANAL_LABEL[r.canal] ?? r.canal}</div>
                    </td>
                    <td>
                      <div className="ter-actions" onClick={e => e.stopPropagation()}>
                        {r.estado === 'PENDIENTE' && (
                          <>
                            <button className="ter-action-btn ter-action-restore" title="Confirmar"
                              onClick={() => setCambioEstado({ reserva: r, a: 'CONFIRMADA' })}><Check size={15} strokeWidth={2} /></button>
                            <button className="ter-action-btn ter-action-danger" title="Rechazar"
                              onClick={() => setCambioEstado({ reserva: r, a: 'RECHAZADA' })} disabled={isPending}><X size={15} strokeWidth={2} /></button>
                          </>
                        )}
                        {r.estado === 'CONFIRMADA' && (
                          <button className="ter-action-btn ter-action-danger" title="Cancelar reserva"
                            onClick={() => setCambioEstado({ reserva: r, a: 'CANCELADA' })} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
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
      </>
      )}

      {/* ── Tab: Turnos ──────────────────────────────────────────────────── */}
      {activeTab === 'turnos' && (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Turnos</h2>
          <button className="btn btn-primary btn-sm" onClick={openNuevaFranja}><Plus size={14} strokeWidth={2.5} /> Nuevo turno</button>
        </div>
        {data.franjas.length === 0 ? (
          <div className="mon-empty">
            <Calendar size={36} strokeWidth={1} opacity={0.2} />
            <p>Aún no hay turnos. Crea al menos uno (ej: «Almuerzo», «Comida») para empezar a recibir reservas.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Horario</th>
                  <th className="tes-col-monto">Capacidad</th>
                  <th>Estado</th>
                  <th className="alm-col-act"></th>
                </tr>
              </thead>
              <tbody>
                {data.franjas.map(f => (
                  <tr key={f.franja_id}>
                    <td><strong>{f.nombre}</strong></td>
                    <td className="text-sm-muted">
                      {f.hora_inicio ? `${formatHora(f.hora_inicio)} – ${formatHora(f.hora_fin)}` : 'Sin hora'}
                      {f.dias_semana && f.dias_semana.length > 0 && f.dias_semana.length < 7 && (
                        <div className="text-xs-muted">{f.dias_semana.map(d => DIA_LABEL[d]).join(', ')}</div>
                      )}
                    </td>
                    <td className="tes-col-monto tes-monto-cell">{f.capacidad}</td>
                    <td>
                      <span className={`badge ${f.activa ? 'badge-success' : 'badge-neutral'}`}>{f.activa ? 'Activo' : 'Inactivo'}</span>
                    </td>
                    <td>
                      <div className="ter-actions">
                        <button className="ter-action-btn" title="Editar" onClick={() => openEditFranja(f)}><Pencil size={15} strokeWidth={2} /></button>
                        <button className="ter-action-btn ter-action-danger" title="Eliminar"
                          onClick={() => setDelFranja(f)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
                      </div>
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

      {/* Confirmación automática */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Confirmación de reservas</h2>
        </div>
        <div className="ter-form-grid res-conf-pad">
          <div className="input-group ter-col-full">
            <label>¿Confirmar las reservas automáticamente?</label>
            <div className="res-switch-wrap">
              <label className="switch">
                <input type="checkbox" checked={confirmAuto}
                  onChange={e => setConfirmAuto(e.target.checked)} />
                <span className="switch-track" aria-hidden="true" />
              </label>
              <span className="res-switch-text">
                {confirmAuto ? 'Automática' : 'Manual'}
              </span>
            </div>
            <span className="input-hint">
              {confirmAuto
                ? 'Las reservas se confirman solas al crearse. El cliente ve la confirmación al instante.'
                : 'Tú confirmas cada reserva manualmente. El cliente queda pendiente hasta que la revises.'}
            </span>
          </div>
        </div>
      </div>

      {/* Enlace público */}
      <div className="card res-section">
        <div className="card-header">
          <h2 className="card-title">Enlace de reservas</h2>
        </div>

        {data.slug && !editandoSlug ? (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Enlace</th>
                  <th className="alm-col-act"></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>claux.app/{data.slug}/reservar</strong>
                    <div className="text-xs-muted">Comparte este enlace con tus clientes.</div>
                  </td>
                  <td>
                    <div className="ter-actions">
                      <button className="ter-action-btn" title="Copiar enlace"
                        onClick={() => { copiarEnlace(); toastSuccess('Enlace copiado.') }} disabled={isPending}>
                        <Copy size={15} strokeWidth={2} />
                      </button>
                      <button className="ter-action-btn" title="Editar enlace"
                        onClick={() => setEditandoSlug(true)} disabled={isPending}>
                        <Pencil size={15} strokeWidth={2} />
                      </button>
                    </div>
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
                  <span className="res-slug-prefix">claux.app/</span>
                  <input className="input" name="slug" placeholder="tu-negocio"
                    value={slugForm} onChange={e => setSlugForm(e.target.value)} />
                  <span className="res-slug-suffix">/reservar</span>
                </div>
                <span className="input-hint">Solo letras, números y guiones.</span>
              </div>
            </div>
            <div className="res-form-submit res-actions-row">
              {data.slug && (
                <button type="button" className="btn btn-secondary" onClick={() => { setEditandoSlug(false); setSlugForm(data.slug ?? '') }}>Cancelar</button>
              )}
              <button type="submit" className="btn btn-primary" disabled={isPending}>
                {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : data.slug ? 'Modificar enlace' : 'Guardar enlace'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Bot de Telegram */}
      <div className="card res-section">
        <div className="card-header">
          <h2 className="card-title">Bot de Telegram</h2>
        </div>

        {data.bot_config.token ? (
          <>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Token</th>
                    <th>Estado</th>
                    <th className="alm-col-act"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>{data.bot_config.nombre ?? '—'}</strong></td>
                    <td className="text-sm-muted">{data.bot_config.token ? `${data.bot_config.token.substring(0, 10)}…` : '—'}</td>
                    <td>
                      <span className={`badge ${data.bot_config.activo ? 'badge-success' : 'badge-neutral'}`}>
                        {data.bot_config.activo ? 'Activo' : 'Inactivo'}
                      </span>
                      {data.bot_config.webhook_registrado && (
                        <div className="text-xs-muted">Webhook registrado</div>
                      )}
                    </td>
                    <td>
                      <div className="ter-actions">
                        <button className="ter-action-btn" title={data.bot_config.activo ? 'Desactivar bot' : 'Activar bot'}
                          onClick={() => setConfirmToggleBot(!data.bot_config.activo)} disabled={isPending}>
                          {data.bot_config.activo ? <PowerOff size={15} strokeWidth={2} /> : <Power size={15} strokeWidth={2} />}
                        </button>
                        <button className="ter-action-btn ter-action-danger" title="Eliminar bot"
                          onClick={eliminarBot} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
                      </div>
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
                  Recibirás ahí cada reserva nueva, con botones para confirmarla o rechazarla.
                </span>
              </div>
            ) : (
              <div className="info-box">
                <span className="text-xs-muted">✓ Chat del dueño vinculado · recibes los avisos de reservas nuevas.</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="info-box">
              <strong className="info-box-title">Cómo configurarlo</strong>
              <span className="text-xs-muted">
                Abre <strong>@BotFather</strong> en Telegram, crea un bot con <code>/newbot</code> y pega aquí el token.
                El nombre de usuario debe terminar en <strong>_bot</strong> (ej: LaBodeguita_bot).
                Tras guardar verás un código para vincular tu chat y recibir los avisos de reservas.
              </span>
            </div>

            <form onSubmit={handleBotSubmit}>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-3">
                  <label>Nombre del bot</label>
                  <input className="input" name="nombre" placeholder="LaBodeguitaBot"
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

      </>
      )}

      {/* Modales */}
      {showNueva && (
        <NuevaReservaModal data={data} onClose={() => setShowNueva(false)} onSaved={onSaved} />
      )}
      {cambioEstado && (
        <CambiarEstadoModal reserva={cambioEstado.reserva} nuevoEstado={cambioEstado.a}
          onConfirm={doCambiarEstado} onClose={() => setCambioEstado(null)} isPending={isPending} />
      )}
      {showFranja && (
        <FranjaModal franja={editFranja}
          onClose={() => { setShowFranja(false); setEditFranja(null) }} onSaved={onFranjaSaved} />
      )}
      {delFranja && (
        <ConfirmEliminarFranja franja={delFranja} onConfirm={doEliminarFranja}
          onClose={() => setDelFranja(null)} isPending={isPending} />
      )}
      {detalleReserva && (
        <ReservaDetalleModal reserva={detalleReserva}
          onClose={() => setDetalleReserva(null)}
          onCambiarEstado={(a) => { setDetalleReserva(null); setCambioEstado({ reserva: detalleReserva, a }) }}
          onEditar={() => { setDetalleReserva(null); setEditarReserva(detalleReserva) }} />
      )}
      {editarReserva && (
        <EditarReservaModal reserva={editarReserva} data={data}
          onClose={() => setEditarReserva(null)} onSaved={() => { setEditarReserva(null); router.refresh() }} />
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
                  ? '¿Activar el bot de Telegram? Los clientes podrán usarlo.'
                  : '¿Desactivar el bot de Telegram? Dejará de responder a los clientes.'}
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmToggleBot(null)}>Cancelar</button>
              <button type="button" className={`btn ${confirmToggleBot ? 'btn-primary' : 'btn-danger'}`} onClick={() => { toggleBot(confirmToggleBot); setConfirmToggleBot(null) }} disabled={isPending}>
                {confirmToggleBot ? 'Activar' : 'Desactivar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
