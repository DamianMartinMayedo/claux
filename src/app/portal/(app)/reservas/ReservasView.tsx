'use client'

import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter, useSearchParams }       from 'next/navigation'
import {
  crearReserva,
  modificarReserva,
  cambiarEstadoReserva,
  cambiarEstadoReservasEnLote,
  type ResultadoLote,
  guardarFranja,
  eliminarFranja,
  guardarBotConfig,
  eliminarBotConfig,
  toggleActivoBot,
  toggleIaBotReservas,
  guardarConfirmacionReservas,
  obtenerDisponibilidadPortal,
  type Disponibilidad,
  type ReservaFranja,
  type ReservaConFranja,
  type ReservaPageData,
} from '@/app/actions/portal/reservas'
import { guardarSlug } from '@/app/actions/portal/agenda-comun'
import {
  ESTADO_LABEL, ESTADO_BADGE, ESTADOS_DESHACIBLES, type EstadoReserva,
} from '@/lib/reservas/estados'
import Tabs from '@/components/Tabs'
import CierresSection from '@/components/portal/CierresSection'
import { RowActions } from '@/components/portal/RowActions'
import FormHelp from '@/components/portal/FormHelp'
import BulkBar from '@/components/portal/BulkBar'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { usePagination, TablePagination } from '@/components/TablePagination'
import TablaCargando from '@/components/portal/TablaCargando'
import ReglasReservaSection from '@/components/portal/ReglasReservaSection'
import IaBotBanner from '@/components/portal/IaBotBanner'
import QrEnlace from '@/components/portal/QrEnlace'
import BotDiagnostico from '@/components/portal/BotDiagnostico'
import AvisarCliente from '@/components/portal/AvisarCliente'
import HistorialClienteLinea from '@/components/portal/HistorialCliente'
import { Calendar, Check, Copy, Eye, Pencil, Plus, Power, PowerOff, Trash2, Undo2, UserX, X } from 'lucide-react'
import ExportarMenu from '@/components/portal/ExportarMenu'
import Filtros from '@/components/portal/Filtros'
import AvisoTope from '@/components/portal/AvisoTope'
import { filtroExport, resumenDe, type Filtro } from '@/lib/filtros'
import { type PresetRango } from '@/lib/listados'
import Link from 'next/link'
import { hoyEnTz, sumarDias } from '@/lib/fecha-tz'
import { DIAS_CIERRE_AUTO } from '@/lib/reservas/estados'

// ── Constantes ────────────────────────────────────────────────────────────────

const CANAL_LABEL: Record<string, string> = { web: 'Web', bot: 'Bot', manual: 'Manual' }

/**
 * Presets del rango de Reservas: miran al FUTURO.
 *
 * Una reserva es lo que hay que atender, no lo que ya pasó, así que el juego histórico de
 * los listados de Contabilidad («Últimos 3 meses») no sirve aquí. «Mes pasado» se queda para
 * repasar no-shows, y «Todo» para buscar una reserva antigua por nombre.
 */
const PRESETS_RESERVAS: PresetRango[] = ['prox_30', 'prox_3_meses', 'mes', 'mes_pasado', 'todo']
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

// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: a partir de las 20:00
// `toISOString()` ya da la fecha de mañana, así que el defecto de un `type=date` se
// adelantaba un día cada noche. Una sola fuente: `lib/fecha-tz.ts`.
function hoyISO(): string { return hoyEnTz() }
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
  const [dispInfo,   setDispInfo]   = useState<Disponibilidad | null>(null)
  // Lo que la base rechazó pero el dueño puede saltarse. Guarda el formulario porque
  // el `<form>` ya se ha enviado cuando aparece el diálogo.
  const [forzar, setForzar] = useState<{ motivo: string; datos: FormData } | null>(null)

  function chequearDisponibilidad(franja: string, fecha: string, hora: string) {
    if (!franja || !fecha || !hora) { setDispInfo(null); return }
    // Lectura del PORTAL, no la pública: el panel no consume el cupo anti-scraping
    // de la mini-web, y el client_id sale de la sesión (RES-3).
    obtenerDisponibilidadPortal(franja, fecha, hora)
      .then(setDispInfo)
      .catch(() => setDispInfo(null))
  }

  function enviar(fd: FormData, forzado: boolean) {
    const ld = toastLoading('Creando…')
    startTransition(async () => {
      const res = await crearReserva(fd, forzado)
      await ld.dismiss()
      if (!res.ok) {
        // El sistema avisa, no bloquea: si el motivo es de los que decide el dueño,
        // se le pregunta en vez de dejarle con un error y sin salida.
        if (res.forzable) { setForzar({ motivo: res.error ?? '', datos: fd }); return }
        toastError(res.error ?? 'Error inesperado.'); return
      }
      toastSuccess(res.avisos?.length ? `Reserva creada — ${res.avisos.join(' ')}` : 'Reserva creada.')
      onSaved()
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    enviar(new FormData(e.currentTarget), false)
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
                  <label>Hora <span className="required">*</span></label>
                  <select className="input" name="hora" required
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
                      {/* El otro tope: cuántos grupos/mesas caben, que no es lo mismo
                          que cuánta gente cabe. Solo si el turno lo tiene puesto. */}
                      {dispInfo.max_reservas > 0 && ` · ${dispInfo.reservas} de ${dispInfo.max_reservas} reservas`}
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
        {forzar && (
          <ConfirmDialog
            title="¿La añades igualmente?"
            body={`${forzar.motivo} Es tu negocio: puedes meterla de todas formas y quedará marcada como forzada.`}
            confirmLabel="Añadir igualmente"
            onCancel={() => setForzar(null)}
            onConfirm={() => { const fd = forzar.datos; setForzar(null); enviar(fd, true) }}
          />
        )}
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
    ATENDIDA:   `¿Dar por atendida la reserva de ${reserva.nombre_cliente}?`,
    CANCELADA:  `¿Cancelar la reserva de ${reserva.nombre_cliente}?`,
    // Deshacer: vuelve a ocupar la plaza, y la plaza pudo llenarse mientras tanto.
    PENDIENTE:  `¿Recuperar la reserva de ${reserva.nombre_cliente}? Vuelve a ocupar sitio, así que puede fallar si el turno se ha llenado.`,
    CADUCADA:   '',
  }
  const positivo = nuevoEstado === 'CONFIRMADA' || nuevoEstado === 'ATENDIDA' || nuevoEstado === 'PENDIENTE'

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{nuevoEstado === 'PENDIENTE' ? 'Recuperar reserva' : `${ESTADO_LABEL[nuevoEstado]} reserva`}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">{mensajes[nuevoEstado]}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className={`btn ${positivo ? 'btn-primary' : 'btn-danger'}`}
            onClick={onConfirm} disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Procesando…</>
              : nuevoEstado === 'PENDIENTE' ? 'Recuperar' : ESTADO_LABEL[nuevoEstado]}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: detalle de reserva ──────────────────────────────────────────────────

function ReservaDetalleModal({
  reserva, onClose, onCambiarEstado, onEditar, puedeEditar,
}: {
  reserva:         ReservaConFranja
  onClose:         () => void
  onCambiarEstado: (a: EstadoReserva) => void
  onEditar:        () => void
  puedeEditar:     boolean
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
            {/* «3ª visita · 1 no asistió»: lo que el dueño sabría de memoria si el
                cliente fuera de siempre, y que el software no le decía. */}
            <HistorialClienteLinea telefono={reserva.telefono} />
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
        {puedeEditar && (
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
              <button type="button" className="btn btn-success btn-sm" onClick={() => onCambiarEstado('ATENDIDA')}>
                <Check size={14} strokeWidth={2} /> Atendió
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCambiarEstado('NO_SHOW')}>
                <UserX size={14} strokeWidth={2} /> No asistió
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onCambiarEstado('CANCELADA')}>
                <Trash2 size={14} strokeWidth={2} /> Cancelar
              </button>
            </>
          )}
        </div>
        )}
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
  const [forzar, setForzar] = useState<{ motivo: string; datos: FormData } | null>(null)

  function enviar(fd: FormData, forzado: boolean) {
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await modificarReserva(reserva.reserva_id, fd, forzado)
      await ld.dismiss()
      if (!res.ok) {
        if (res.forzable) { setForzar({ motivo: res.error ?? '', datos: fd }); return }
        toastError(res.error ?? 'Error inesperado.'); return
      }
      toastSuccess(res.avisos?.length ? `Reserva actualizada — ${res.avisos.join(' ')}` : 'Reserva actualizada.')
      onSaved()
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    enviar(new FormData(e.currentTarget), false)
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        {forzar && (
          <ConfirmDialog
            title="¿La guardas igualmente?"
            body={`${forzar.motivo} Es tu negocio: puedes guardarla de todas formas y quedará marcada como forzada.`}
            confirmLabel="Guardar igualmente"
            onCancel={() => setForzar(null)}
            onConfirm={() => { const fd = forzar.datos; setForzar(null); enviar(fd, true) }}
          />
        )}
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
                <label>Hora <span className="required">*</span></label>
                <select className="input" name="hora" required defaultValue={reserva.hora?.substring(0, 5) ?? ''}>
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
    const ld = toastLoading(isEdit ? 'Guardando…' : 'Creando…')
    startTransition(async () => {
      const res = await guardarFranja(fd)
      await ld.dismiss()
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
                <div className="form-label-with-help">
                  <label>Capacidad <span className="required">*</span></label>
                  <FormHelp text="Cuánta gente cabe a la vez." label="Qué es la capacidad" />
                </div>
                <input className="input" name="capacidad" type="number" min="1" required
                  defaultValue={franja?.capacidad ?? 1} />
              </div>
              <div className="input-group ter-col-span-3">
                {/* La confusión natural es creer que esto es lo mismo que la capacidad.
                    No lo es: veinte parejas llenan un salón de 40 plazas. */}
                <div className="form-label-with-help">
                  <label>Máx. reservas</label>
                  <FormHelp text="Cuántas mesas o grupos puedes atender a la vez. 0 = sin tope." label="Qué es el máximo de reservas" />
                </div>
                <input className="input" name="max_reservas" type="number" min="0"
                  defaultValue={franja?.max_reservas ?? 0} />
              </div>
              <div className="input-group ter-col-span-3">
                <div className="form-label-with-help">
                  <label>Duración (min) <span className="required">*</span></label>
                  <FormHelp text="Tiempo que ocupa cada reserva (mín. 15 min)." label="Qué es la duración" />
                </div>
                <input className="input" name="duracion_minutos" type="number" min="15" required
                  defaultValue={franja?.duracion_minutos ?? 60} />
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
                <div className="form-label-with-help">
                  <label>Días</label>
                  <FormHelp text="Sin selección = todos los días." label="Cómo funcionan los días" />
                </div>
                <div className="res-dias-row">
                  {[1, 2, 3, 4, 5, 6, 7].map(d => (
                    <label key={d} className="res-dias-item">
                      <input type="checkbox" name="dias_semana" value={String(d)}
                        defaultChecked={franja?.dias_semana ? franja.dias_semana.includes(d) : true} />
                      {DIA_LABEL[d]}
                    </label>
                  ))}
                </div>
              </div>
              {/* RES-1: sin esta casilla, dejar de ofrecer un turno solo se podía hacer
                  ELIMINÁNDOLO — y eliminar está bloqueado si tiene reservas futuras. */}
              <div className="input-group ter-col-full">
                <div className="form-label-with-help">
                  <label className="res-dias-item">
                    <input type="checkbox" name="activa" defaultChecked={franja ? franja.activa : true} />
                    Turno activo
                  </label>
                  <FormHelp text="Desactivado deja de ofrecerse en la web y en el bot, pero conserva sus reservas." label="Qué hace desactivar el turno" />
                </div>
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

export default function ReservasView({ data, puedeEditar, children }: { data: ReservaPageData; puedeEditar: boolean; children?: React.ReactNode }) {
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

  // Host de la plataforma para el enlace público (dinámico, no hardcodeado): se
  // deriva de NEXT_PUBLIC_SITE_URL. La copia del enlace usa el origin real.
  const host = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')

  // Los filtros viven en la URL, como en el resto del portal (`skills/ui/SKILL.md` §3.3):
  // refrescar —o que se caiga la conexión, que en Cuba es el caso normal— ya no tira lo que
  // el dueño acaba de poner, y volver del detalle lo devuelve a lo que estaba mirando.
  // El rango y la búsqueda los aplica LA CONSULTA; el servidor devuelve cuál usó.
  const params = useSearchParams()
  const search       = data.q
  const filtroFranja = params.get('franja') ?? ''
  const filtroEstado = params.get('estado') ?? ''

  const [slugForm, setSlugForm] = useState(data.slug ?? '')
  const [editandoSlug, setEditandoSlug] = useState(false)
  const [botForm, setBotForm] = useState({
    token:  data.bot_config.token ?? '',
    nombre: data.bot_config.nombre ?? '',
  })
  const [confirmAuto, setConfirmAuto] = useState(data.bot_config.confirmacion_automatica)

  // Estos dos formularios se resincronizan cuando el servidor manda datos nuevos (tras
  // guardar + router.refresh()). Se ajusta DURANTE el render comparando con lo último
  // visto — el patrón de React para estado derivado de props. Con `useEffect` + setState
  // se pinta primero un fotograma con el valor viejo y luego se re-renderiza en cascada.
  // Y la comparación va por VALOR, no por identidad del objeto: un `[data.bot_config]` se
  // dispara en cada refresco del servidor y puede pisar lo que el dueño esté escribiendo
  // en el campo del token. Mismo patrón que `CitasView`, que ya lo tenía resuelto.
  const slugServidor = data.slug ?? ''
  const [slugVisto, setSlugVisto] = useState(slugServidor)
  if (slugVisto !== slugServidor) {
    setSlugVisto(slugServidor)
    setSlugForm(slugServidor)
  }

  const botKey = `${data.bot_config.token ?? ''}|${data.bot_config.nombre ?? ''}|${data.bot_config.confirmacion_automatica}`
  const [botVisto, setBotVisto] = useState(botKey)
  if (botVisto !== botKey) {
    setBotVisto(botKey)
    setBotForm({ token: data.bot_config.token ?? '', nombre: data.bot_config.nombre ?? '' })
    setConfirmAuto(data.bot_config.confirmacion_automatica)
  }

  const hoy = hoyISO()

  /**
   * LA DECLARACIÓN. De aquí salen la barra, el `FiltroExport` de la descarga y el texto del
   * desplegable — antes se escribían por separado y el fichero no se parecía a la pantalla.
   *
   * `escalado` en los dos: mientras el listado quepa entero, el navegador filtra al instante
   * y da el MISMO resultado que la consulta; en cuanto hay filas sin traer, sube al servidor,
   * porque un filtro que solo mira las 500 más recientes miente sin decirlo.
   */
  const declaracion: Filtro[] = useMemo(() => [
    {
      clave: 'estado', label: 'Todos los estados', valor: filtroEstado,
      rotulo: 'Estado',
      widget: 'select', donde: 'escalado',
      opciones: (Object.keys(ESTADO_LABEL) as EstadoReserva[])
        .map(k => ({ valor: k, label: ESTADO_LABEL[k] })),
    },
    {
      // La franja es «el turno» en el que cae la reserva (`reserva_franjas`). Viaja a la
      // descarga como `categoria`, que es la clave que el registro aplica sobre esa columna.
      clave: 'categoria', param: 'franja', label: 'Todos los turnos', valor: filtroFranja,
      rotulo: 'Turno',
      widget: 'select', donde: 'escalado',
      ocultarSi: data.franjas.length === 0,
      opciones: data.franjas.map(f => ({ valor: f.franja_id, label: f.nombre })),
    },
  ], [filtroEstado, filtroFranja, data.franjas])

  // El rango y la búsqueda ya los aplicó la CONSULTA: aquí solo quedan los dos filtros
  // escalados, que mientras no haya truncamiento dan el mismo resultado sin gastar un viaje.
  const reservas = useMemo(() => data.reservas.filter(r => {
    if (filtroFranja && r.franja_id !== filtroFranja) return false
    if (filtroEstado && r.estado    !== filtroEstado) return false
    return true
  }), [data.reservas, filtroFranja, filtroEstado])

  const { pageItems: reservaItems, ...reservaPag } = usePagination(reservas)
  const [cargando, setCargando] = useState(false)

  // ── Selección múltiple (cambiar estado en lote) ──
  const reservaIds = useMemo(() => reservas.map(r => r.reserva_id), [reservas])
  const sel = useRowSelection(reservaIds)
  const [loteAccion, setLoteAccion] = useState<{ estado: EstadoReserva; label: string } | null>(null)
  useEffect(() => { sel.clear() }, [activeTab, search, data.rango.desde, data.rango.hasta, filtroFranja, filtroEstado]) // eslint-disable-line react-hooks/exhaustive-deps
  const plural = (n: number) => n === 1 ? '' : 's'

  function ejecutarLote(estado: EstadoReserva) {
    const ld = toastLoading('Procesando…')
    startTransition(async () => {
      const r: ResultadoLote = await cambiarEstadoReservasEnLote(sel.selectedIds, estado)
      await ld.dismiss()
      if (r.error) { toastError(r.error); return }
      const partes: string[] = []
      if (r.hechas)          partes.push(`${r.hechas} cambiada${plural(r.hechas)}`)
      if (r.omitidas.length) partes.push(`${r.omitidas.length} omitida${plural(r.omitidas.length)}`)
      if (r.errores.length)  partes.push(`${r.errores.length} con error`)
      const msg = partes.join(' · ') || 'Nada que hacer'
      if (r.hechas > 0 && r.errores.length === 0) toastSuccess(msg)
      else if (r.hechas > 0)                      toastError(msg)
      else                                        toastError(r.omitidas[0]?.motivo ? `Nada aplicado — ${r.omitidas[0].motivo}` : msg)
      sel.clear()
      router.refresh()
    })
  }

  // Lo de hoy lo cuenta la consulta (U3). Antes se filtraba `data.reservas`, que es el
  // rango cargado: poner «Mes pasado» en la barra vaciaba la cabecera.
  const { pendientes: pendientesHoy, confirmadas: confirmadasHoy, total: totalHoy } = data.hoy
  const ayer = sumarDias(hoy, -1)

  /**
   * Ocupación de los próximos 7 días por turno (4.2), calculada sobre las reservas que
   * la vista YA trae — sin una consulta más. Es un porcentaje de personas sobre la
   * capacidad diaria del turno: `capacidad × días que ese turno atiende en la semana`.
   *
   * Solo se pinta si el rango cargado cubre esos 7 días; con «Mes pasado» puesto el
   * dato no existe y decir 0 % sería mentir, así que se pone «—».
   */
  const ocupacion7d = useMemo(() => {
    const fin = sumarDias(hoy, 7)
    const cubre = data.rango.desde <= hoy && (!data.rango.hasta || data.rango.hasta >= fin)
    const m = new Map<string, number | null>()
    for (const f of data.franjas) {
      if (!cubre) { m.set(f.franja_id, null); continue }
      const dias = f.dias_semana && f.dias_semana.length > 0 ? f.dias_semana.length : 7
      const techo = f.capacidad * dias
      if (techo <= 0) { m.set(f.franja_id, null); continue }
      const usado = data.reservas
        .filter(r => r.franja_id === f.franja_id && r.fecha >= hoy && r.fecha < fin
          && (r.estado === 'PENDIENTE' || r.estado === 'CONFIRMADA'))
        .reduce((s, r) => s + r.personas, 0)
      m.set(f.franja_id, Math.round((usado / techo) * 100))
    }
    return m
  }, [data.franjas, data.reservas, data.rango.desde, data.rango.hasta, hoy])

  function onSaved() { setShowNueva(false); router.refresh() }

  function doCambiarEstado() {
    if (!cambioEstado) return
    const ld = toastLoading('Procesando…')
    startTransition(async () => {
      const res = await cambiarEstadoReserva(cambioEstado.reserva.reserva_id, cambioEstado.a)
      await ld.dismiss()
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
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarFranja(delFranja.franja_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelFranja(null); return }
      toastSuccess('Turno eliminado.')
      setDelFranja(null); router.refresh()
    })
  }

  function handleSlugSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarSlug(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Enlace guardado.')
      setEditandoSlug(false)
      router.refresh()
    })
  }

  // La confirmación automática se guarda sola al cambiar el switch (no depende del
  // bot): aplica también a las reservas web. Optimista, con reversión si falla.
  function handleConfirmAuto(v: boolean) {
    setConfirmAuto(v)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarConfirmacionReservas(v)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'No se pudo guardar.'); setConfirmAuto(!v); return }
      toastSuccess(v ? 'Las reservas se confirmarán automáticamente.' : 'Confirmarás cada reserva manualmente.')
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
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarBotConfig(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Configuración guardada.')
      router.refresh()
    })
  }

  function copiarEnlace() {
    if (!data.slug) return
    navigator.clipboard.writeText(`${window.location.origin}/${data.slug}/reservar`)
  }

  function eliminarBot() {
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarBotConfig()
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Bot eliminado.')
      router.refresh()
    })
  }

  function toggleBot(activo: boolean) {
    const ld = toastLoading('Actualizando…')
    startTransition(async () => {
      const res = await toggleActivoBot(activo)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(activo ? 'Bot activado.' : 'Bot desactivado.')
      router.refresh()
    })
  }

  function toggleIaBot(activa: boolean) {
    const ld = toastLoading('Actualizando…')
    startTransition(async () => {
      const res = await toggleIaBotReservas(activa)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(activa ? 'La IA gestionará el bot.' : 'La IA ya no gestiona el bot.')
      router.refresh()
    })
  }

  return (
    <div className="view-container">

      <div className="page-header">
        <div>
          <div className="page-title-ia">
            {/* Estaba a fuego: el menú y la página podían decir cosas distintas. */}
            <h1 className="page-title">{data.etiqueta_reservas}</h1>
            <IaTouchpoint tipo="reservas" descripcion="un análisis de tus reservas" />
          </div>
          <p className="page-subtitle">
            {activeTab === 'reservas' && totalHoy > 0
              ? `Hoy: ${pendientesHoy} pendientes · ${confirmadasHoy} confirmadas · Total ${totalHoy}`
              : 'Gestiona las reservas de tus clientes.'}
          </p>
        </div>
        <div className="tes-header-actions">
          {activeTab === 'reservas' && (
            <ExportarMenu
              clave="reservas"
              /* La búsqueda y el turno VIAJAN: se filtraban en pantalla y el fichero salía
                 con todas las reservas. `tipo` es el canal en la tabla, y la franja es lo
                 que el registro aplica ahí (`reserva_franjas`). */
              filtro={filtroExport(declaracion, {
                desde: data.rango.desde, hasta: data.rango.hasta, q: search,
              })}
              resumen={[...resumenDe(declaracion), ...(search ? [`«${search}»`] : [])]}
            />
          )}
          {activeTab === 'reservas' && puedeEditar && (
            <button className="btn btn-primary" onClick={() => setShowNueva(true)}>
              <Plus size={14} strokeWidth={2.5} /> Nueva reserva
            </button>
          )}
        </div>
      </div>
      {children}

      <Tabs
        ariaLabel="Secciones de reservas"
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          // El conteo es el TOTAL del rango (`count: 'exact'`), no las filas traídas: con el
          // techo puesto, contar lo cargado diría «500» sobre un conjunto mayor.
          { id: 'reservas', label: 'Reservas', count: data.total },
          { id: 'turnos', label: 'Turnos', count: data.franjas.length },
          { id: 'configuracion', label: 'Configuración' },
        ]}
      />

      {/* ── Tab: Reservas ────────────────────────────────────────────────── */}
      {activeTab === 'reservas' && (
      <>

      {/* Antes eran dos `<input type=date>` sin rótulo y con una trampa: al dejar «hasta»
          vacío, el filtro caía a `filtroHasta || filtroDesde`, así que pedir «desde el 1 de
          agosto» enseñaba SOLO el 1 de agosto. El rango del portal dice el rango que aplica
          y sus presets viven en su panel. */}
      <Filtros
        filtros={declaracion}
        rango={data.rango}
        q={search}
        placeholder="Buscar por cliente, teléfono o notas…"
        presets={PRESETS_RESERVAS}
        hayMas={data.hay_mas}
        onCargando={setCargando}
      />

      {data.hay_mas && (
        <AvisoTope mostrados={data.reservas.length} total={data.total}
          limite={data.limite} sustantivo="reservas" femenino />
      )}

      {/* Por cerrar: confirmadas de días pasados que nadie ha marcado. Con el rango
          por defecto (hoy → +30) no se ven, así que el aviso lleva al listado ya
          filtrado y el trabajo se hace con la BulkBar de siempre — no hay una segunda
          tabla que mantener. */}
      {data.por_cerrar > 0 && (
        <div className="alert alert-warning alert-cta">
          <div className="alert-cta-texto">
            <strong className="alert-titulo">
              {data.por_cerrar} reserva{plural(data.por_cerrar)} sin cerrar
            </strong>
            Son de días que ya pasaron y siguen confirmadas. Márcalas como atendidas o como
            «no asistió»; a los {DIAS_CIERRE_AUTO} días se cierran solas.
          </div>
          <Link className="btn btn-aviso btn-sm" href={`/portal/reservas?estado=CONFIRMADA&desde=&hasta=${ayer}`}>
            Verlas
          </Link>
        </div>
      )}

      <TablaCargando activo={cargando}>
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
                  {puedeEditar && (
                    <th className="col-check">
                      <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                    </th>
                  )}
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Turno</th>
                  <th>Cliente</th>
                  <th className="col-num">Pers.</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {reservaItems.map(r => (
                  <tr key={r.reserva_id} className="table-row-clickable"
                    onClick={() => setDetalleReserva(r)}>
                    {puedeEditar && (
                      <td className="col-check" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="row-check"
                          checked={sel.isSelected(r.reserva_id)}
                          onChange={() => sel.toggle(r.reserva_id)}
                          aria-label={`Seleccionar reserva de ${r.nombre_cliente}`} />
                      </td>
                    )}
                    <td data-label="Fecha"><strong>{formatFecha(r.fecha)}</strong></td>
                    <td data-label="Hora" className="tes-nowrap">
                      {r.hora ? `${r.hora.substring(0, 5)}${r.hora_fin ? ` – ${r.hora_fin.substring(0, 5)}` : ''}` : '—'}
                    </td>
                    <td data-label="Turno">
                      {r.franja_nombre}
                      {r.franja_hora_inicio && <div className="text-sm-muted">{formatHora(r.franja_hora_inicio)} – {formatHora(r.franja_hora_fin)}</div>}
                    </td>
                    <td data-label="Cliente">
                      <strong className="cell-clamp">{r.nombre_cliente}</strong>
                      {r.telefono && <div className="text-sm-muted">{r.telefono}</div>}
                      {r.notas && <div className="text-sm-muted">{r.notas}</div>}
                    </td>
                    <td data-label="Pers." className="col-num tes-monto-cell">{r.personas}</td>
                    <td data-label="Estado">
                      <div className="badge-row">
                        <span className={`badge ${ESTADO_BADGE[r.estado]}`}>{ESTADO_LABEL[r.estado]}</span>
                        {r.forzada && <span className="badge badge-warning" title="Se metió saltándose una regla del turno">forzada</span>}
                      </div>
                      <div className="text-xs-muted">{CANAL_LABEL[r.canal] ?? r.canal}</div>
                      {/* La diferencia entre un valor por defecto y un dato inventado:
                          si «Atendió» lo puso el barrido, se dice. */}
                      {r.cierre_auto && <div className="text-xs-muted">cerrada automáticamente</div>}
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => setDetalleReserva(r)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                        {puedeEditar && (r.estado === 'PENDIENTE' || r.estado === 'CONFIRMADA') && (
                          <>
                            {r.estado === 'PENDIENTE' && (
                              <>
                                <button className="row-actions-item"
                                  onClick={() => setCambioEstado({ reserva: r, a: 'CONFIRMADA' })}><Check size={15} strokeWidth={2} /> Confirmar</button>
                                <button className="row-actions-item row-actions-item-danger"
                                  onClick={() => setCambioEstado({ reserva: r, a: 'RECHAZADA' })} disabled={isPending}><X size={15} strokeWidth={2} /> Rechazar</button>
                              </>
                            )}
                            {r.estado === 'CONFIRMADA' && (
                              <>
                                <button className="row-actions-item row-actions-item-success"
                                  onClick={() => setCambioEstado({ reserva: r, a: 'ATENDIDA' })} disabled={isPending}><Check size={15} strokeWidth={2} /> Atendió</button>
                                <button className="row-actions-item"
                                  onClick={() => setCambioEstado({ reserva: r, a: 'NO_SHOW' })} disabled={isPending}><UserX size={15} strokeWidth={2} /> No asistió</button>
                                <button className="row-actions-item row-actions-item-danger"
                                  onClick={() => setCambioEstado({ reserva: r, a: 'CANCELADA' })} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Cancelar reserva</button>
                              </>
                            )}
                          </>
                        )}
                        {/* Deshacer: solo si la fecha no ha pasado — recuperar algo de
                            ayer no le sirve a nadie y volvería a ocupar aforo muerto. */}
                        {puedeEditar && ESTADOS_DESHACIBLES.includes(r.estado) && r.fecha >= hoy && (
                          <button className="row-actions-item"
                            onClick={() => setCambioEstado({ reserva: r, a: 'PENDIENTE' })} disabled={isPending}><Undo2 size={15} strokeWidth={2} /> Deshacer</button>
                        )}
                        {/* Sin correo al cliente final, el aviso lo da el dueño — con
                            el mensaje ya escrito y el chat abierto (fase 10). */}
                        <AvisarCliente compacto
                          telefono={r.telefono} chatTelegram={r.telegram_chat_id}
                          datos={{ tipo: 'reserva', negocio: data.negocio, nombre: r.nombre_cliente,
                                   fecha: r.fecha, hora: r.hora, estado: r.estado }} />
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...reservaPag} label="reserva" />
      </div>
      </TablaCargando>
      </>
      )}

      {/* ── Tab: Turnos ──────────────────────────────────────────────────── */}
      {activeTab === 'turnos' && (
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Turnos</h2>
          {puedeEditar && (
            <button className="btn btn-primary btn-sm" onClick={openNuevaFranja}><Plus size={14} strokeWidth={2.5} /> Nuevo turno</button>
          )}
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
                  <th className="col-num">Capacidad</th>
                  <th className="col-num">Ocupación</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {data.franjas.map(f => (
                  <tr key={f.franja_id}>
                    <td data-label="Nombre"><strong className="cell-clamp">{f.nombre}</strong></td>
                    <td data-label="Horario" className="text-sm-muted">
                      {f.hora_inicio ? `${formatHora(f.hora_inicio)} – ${formatHora(f.hora_fin)}` : 'Sin hora'}
                      {f.dias_semana && f.dias_semana.length > 0 && f.dias_semana.length < 7 && (
                        <div className="text-xs-muted">{f.dias_semana.map(d => DIA_LABEL[d]).join(', ')}</div>
                      )}
                    </td>
                    <td data-label="Capacidad" className="col-num tes-monto-cell">
                      {f.capacidad}
                      {f.max_reservas > 0 && <div className="text-xs-muted">máx. {f.max_reservas} reservas</div>}
                    </td>
                    {/* Ocupación (4.2): la pestaña enseñaba la capacidad, que es
                        configuración, y nunca el uso — el dueño no sabía si el sábado
                        estaba lleno sin abrir su propia web y simular una reserva. */}
                    <td data-label="Ocupación" className="col-num tes-monto-cell">
                      {ocupacion7d.get(f.franja_id) == null
                        ? <span className="text-sm-muted">—</span>
                        : <>{ocupacion7d.get(f.franja_id)}%<div className="text-xs-muted">7 días</div></>}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge ${f.activa ? 'badge-success' : 'badge-neutral'}`}>{f.activa ? 'Activo' : 'Inactivo'}</span>
                    </td>
                    <td className="col-actions">
                      {puedeEditar && (
                        <RowActions>
                          <button className="row-actions-item" onClick={() => openEditFranja(f)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                          <button className="row-actions-item row-actions-item-danger"
                            onClick={() => setDelFranja(f)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
                        </RowActions>
                      )}
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
        <IaBotBanner entidad="reservas" activa={data.bot_config.ia_activa}
          isPending={isPending} onToggle={toggleIaBot} />
      )}

      {/* U20: este bloque colgaba suelto encima de las tarjetas, sin tarjeta propia,
          en las dos vistas — parecía un ajuste de la pantalla y no de la funcionalidad. */}
      <div className="card res-section">
        <div className="card-header"><h2 className="card-title">Confirmación automática</h2></div>
        {data.tieneAmbas && (
          <span className="text-xs-muted res-ambito">
            Solo para reservas. Tus citas tienen la suya.
          </span>
        )}
      <div className="res-conf-item">
        <div className="res-conf-item-text">
          <span className="res-conf-item-title">Confirmar sin revisar</span>
          <span className="input-hint">
            {data.tieneIa && data.bot_config.ia_activa
              ? (confirmAuto
                  ? 'La IA confirmará automáticamente las reservas que cumplan las reglas.'
                  : 'La IA creará las reservas pendientes para que tú las confirmes.')
              : (confirmAuto
                  ? 'Las reservas se confirman solas al crearse; el cliente lo ve al instante.'
                  : 'Tú confirmas cada reserva; el cliente queda pendiente hasta que la revises.')}
          </span>
        </div>
        <label className="switch">
          <input type="checkbox" checked={confirmAuto} disabled={isPending}
            onChange={e => handleConfirmAuto(e.target.checked)} aria-label="Confirmar reservas automáticamente" />
          <span className="switch-track" aria-hidden="true" />
        </label>
      </div>
      </div>

      {/* Enlace público */}
      <div className="card res-section">
        <div className="card-header">
          <h2 className="card-title">Enlace de reservas</h2>
        </div>
        {/* Ámbito (11.1): con las DOS funcionalidades contratadas, la pantalla de
            Configuración enseña igual lo que es de esta funcionalidad y lo que es del
            negocio entero. Lo peligroso no es el bot: es cambiar la antelación aquí y
            cambiársela también a Citas sin que nada lo diga. Con una sola contratada,
            estas líneas son ruido y no se pintan. */}
        {data.tieneAmbas && (
          <span className="text-xs-muted res-ambito">
            La ruta <code>/reservar</code> es solo de Reservas, pero <strong>la dirección
            es del negocio</strong>: si la cambias aquí, cambia también en Citas y en tu catálogo.
          </span>
        )}

        {data.slug && !editandoSlug ? (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Enlace</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label="Enlace">
                    <strong>{host}/{data.slug}/reservar</strong>
                    <div className="text-xs-muted">Comparte este enlace con tus clientes.</div>
                  </td>
                  <td className="col-actions">
                    <RowActions>
                      <button className="row-actions-item"
                        onClick={() => { copiarEnlace(); toastSuccess('Enlace copiado.') }} disabled={isPending}>
                        <Copy size={15} strokeWidth={2} /> Copiar enlace
                      </button>
                      {puedeEditar && (
                        <button className="row-actions-item"
                          onClick={() => setEditandoSlug(true)} disabled={isPending}>
                          <Pencil size={15} strokeWidth={2} /> Editar enlace
                        </button>
                      )}
                    </RowActions>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : puedeEditar ? (
          <form onSubmit={handleSlugSubmit}>
            <div className="ter-form-grid res-conf-pad-top">
              <div className="input-group ter-col-full">
                <div className="form-label-with-help">
                  <label>{data.slug ? 'Modificar tu enlace' : 'Tu dirección web para compartir'}</label>
                  <FormHelp text="Solo letras, números y guiones." label="Qué puede llevar el enlace" />
                </div>
                <div className="res-slug-wrap">
                  <span className="res-slug-prefix">{host}/</span>
                  <input className="input" name="slug" placeholder="tu-negocio"
                    value={slugForm} onChange={e => setSlugForm(e.target.value)} />
                  <span className="res-slug-suffix">/reservar</span>
                </div>
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
        ) : null}
      </div>

      {/* QR del enlace: así es como se reparte una dirección en una mesa o un
          mostrador. El catálogo ya lo tenía y estas dos no. */}
      {data.slug && (
        <QrEnlace url={`https://${host}/${data.slug}/reservar`} nombreArchivo={`qr-reservas-${data.slug}`}
          titulo="Código QR de reservas" />
      )}

      {/* Bot de Telegram */}
      <div className="card res-section">
        <div className="card-header">
          <h2 className="card-title">Bot de Telegram · Reservas</h2>
        </div>
        {data.tieneAmbas && (
          <span className="text-xs-muted res-ambito">
            Solo para Reservas. Tus Citas tienen su propio bot, con otro token y otro
            código de vínculo, en <strong>Citas › Configuración</strong>.
          </span>
        )}

        {data.bot_config.token ? (
          <>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Token</th>
                    <th>Estado</th>
                    <th className="col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td data-label="Nombre"><strong>{data.bot_config.nombre ?? '—'}</strong></td>
                    <td data-label="Token" className="text-sm-muted">{data.bot_config.token ? `${data.bot_config.token.substring(0, 10)}…` : '—'}</td>
                    <td data-label="Estado">
                      <span className={`badge ${data.bot_config.activo ? 'badge-success' : 'badge-neutral'}`}>
                        {data.bot_config.activo ? 'Activo' : 'Inactivo'}
                      </span>
                      {/* Deja de enseñarse `webhook_registrado`: es un booleano del día
                          del alta, no lo que pasa ahora. Lo dice «Comprobar». */}
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
                  Abre tu bot de <strong>Reservas</strong> en Telegram y envía <code>/start {data.bot_config.codigo_vinculo ?? '—'}</code>.
                  Recibirás ahí cada reserva nueva, con botones para confirmarla o rechazarla.
                </span>
              </div>
            ) : (
              <div className="info-box">
                <span className="text-xs-muted">
                  ✓ Chat del dueño vinculado · recibes los avisos de reservas nuevas. Si cambias de móvil
                  o de cuenta de Telegram, vuelve a enviar <code>/start {data.bot_config.codigo_vinculo ?? '—'}</code>.
                </span>
              </div>
            )}

            <BotDiagnostico columna="bot_config" />
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

      {/* Reglas de reserva */}
      <ReglasReservaSection reglas={data.reglas} mostrarMaxPersonas iaActiva={data.tieneIa && data.bot_config.ia_activa} compartidas={data.tieneAmbas} />

      {/* Cierres y festivos */}
      <CierresSection cierres={data.cierres} iaActiva={data.tieneIa && data.bot_config.ia_activa} compartidas={data.tieneAmbas} />

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
        <ReservaDetalleModal reserva={detalleReserva} puedeEditar={puedeEditar}
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

      {activeTab === 'reservas' && puedeEditar && (
        <BulkBar count={sel.count} onClear={sel.clear}>
          <button className="btn btn-secondary btn-sm" disabled={isPending}
            onClick={() => setLoteAccion({ estado: 'CONFIRMADA', label: 'Confirmar' })}>
            <Check size={14} strokeWidth={2} /> Confirmar
          </button>
          {/* Cerrar el día en bloque (U5): marcar quién vino y quién no es trabajo de
              fin de servicio, y hasta ahora solo se llegaba de una en una desde el modal. */}
          <button className="btn btn-secondary btn-sm" disabled={isPending}
            onClick={() => setLoteAccion({ estado: 'ATENDIDA', label: 'Marcar atendidas' })}>
            <Check size={14} strokeWidth={2} /> Atendió
          </button>
          <button className="btn btn-secondary btn-sm" disabled={isPending}
            onClick={() => setLoteAccion({ estado: 'NO_SHOW', label: 'Marcar no asistió' })}>
            <UserX size={14} strokeWidth={2} /> No asistió
          </button>
          <button className="btn btn-danger-text btn-sm" disabled={isPending}
            onClick={() => setLoteAccion({ estado: 'RECHAZADA', label: 'Rechazar' })}>
            <X size={14} strokeWidth={2} /> Rechazar
          </button>
          <button className="btn btn-danger-text btn-sm" disabled={isPending}
            onClick={() => setLoteAccion({ estado: 'CANCELADA', label: 'Cancelar' })}>
            <Trash2 size={14} strokeWidth={2} /> Cancelar
          </button>
        </BulkBar>
      )}

      {loteAccion && (
        <ConfirmDialog
          title={`¿${loteAccion.label} ${sel.count} reserva${plural(sel.count)}?`}
          body="Solo se aplica a las que admitan el cambio; el resto se omite. Se notificará a los clientes por Telegram cuando proceda."
          confirmLabel={loteAccion.label}
          danger={loteAccion.estado === 'RECHAZADA' || loteAccion.estado === 'CANCELADA'}
          onCancel={() => setLoteAccion(null)}
          onConfirm={() => { const e = loteAccion.estado; setLoteAccion(null); ejecutarLote(e) }}
        />
      )}
    </div>
  )
}

// ── Checkbox de cabecera (con estado indeterminado) ───────────────────────────

function HeaderCheck({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate: boolean; onChange: () => void
}) {
  return (
    <input type="checkbox" className="row-check" checked={checked}
      ref={el => { if (el) el.indeterminate = indeterminate }}
      onChange={onChange} aria-label="Seleccionar todo" />
  )
}
