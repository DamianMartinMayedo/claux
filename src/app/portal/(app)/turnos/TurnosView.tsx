'use client'

import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter, useSearchParams }        from 'next/navigation'
import {
  guardarTurno,
  eliminarTurno,
  alternarTurno,
  guardarPatron,
  eliminarPatron,
  alternarPatron,
  guardarRoster,
  type Turno,
  type TurnoPatron,
  type TipoPatron,
  type TurnosPageData,
} from '@/app/actions/portal/rrhh'
import { Clock, Pencil, Plus, Power, Repeat, Trash2, Users, X } from 'lucide-react'
import ExportarMenu from '@/components/portal/ExportarMenu'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { horasDeTurno, formatHoras, cruzaMedianoche, posicionEnCiclo } from '@/lib/rrhh/turnos'
import { hoyEnTz, sumarDias } from '@/lib/fecha-tz'

// ── Constantes ────────────────────────────────────────────────────────────────

const DIAS = [
  { n: 1, label: 'Lun', largo: 'lunes' },     { n: 2, label: 'Mar', largo: 'martes' },
  { n: 3, label: 'Mié', largo: 'miércoles' }, { n: 4, label: 'Jue', largo: 'jueves' },
  { n: 5, label: 'Vie', largo: 'viernes' },   { n: 6, label: 'Sáb', largo: 'sábado' },
  { n: 7, label: 'Dom', largo: 'domingo' },
]

const TURNO_COLORS = [
  { value: '#00AFAA', label: 'Teal' },
  { value: '#C97A0C', label: 'Ámbar' },
  { value: '#2E7D32', label: 'Verde' },
  { value: '#1565C0', label: 'Azul' },
  { value: '#6A1B9A', label: 'Morado' },
  { value: '#AD1457', label: 'Rosa' },
]

// Cada tipo fija la longitud del ciclo; CICLO la calcula de N+M.
const TIPOS: { value: TipoPatron; label: string; longitud: number | null }[] = [
  { value: 'SEMANAL',   label: 'Semanal',        longitud: 7 },
  { value: 'QUINCENAL', label: 'Quincenal',      longitud: 14 },
  { value: 'MENSUAL',   label: 'Mensual (4 sem)', longitud: 28 },
  { value: 'CICLO',     label: 'Ciclo N×M',      longitud: null },
]

const HORIZONTES = [
  { value: 7,  label: 'Semana' },
  { value: 14, label: 'Quincena' },
  { value: 30, label: 'Mes' },
]

// SEMANAL: la posición 0 del ciclo se ancla a un lunes fijo, así «posición p» = día de la
// semana p. 2024-01-01 fue lunes. Los demás tipos anclan a la fecha que elige el dueño.
const REF_LUNES = '2024-01-01'

function formatHora(h: string | null): string {
  return h ? h.slice(0, 5) : ''
}
function horario(t: Turno): string {
  if (t.es_descanso) return 'Descanso'
  const i = formatHora(t.hora_inicio), f = formatHora(t.hora_fin)
  if (i && f) return `${i}–${f}${cruzaMedianoche(t) ? ' (+1 día)' : ''}`
  return i || f || 'Sin horario'
}
const nombreDe = (e: { nombre: string; apellidos: string | null }) =>
  [e.nombre, e.apellidos].filter(Boolean).join(' ')

const TIPO_LABEL: Record<TipoPatron, string> = {
  SEMANAL: 'Semanal', QUINCENAL: 'Quincenal', MENSUAL: 'Mensual', CICLO: 'Ciclo',
}

/** Nombre corto del día de la semana de una fecha 'YYYY-MM-DD' (LUNES-based labels). */
function diaSemanaCorto(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const js = new Date(y, m - 1, d).getDay()   // 0=Dom … 6=Sáb
  return DIAS[(js + 6) % 7].label
}
/** Día y mes cortos para la cabecera de la vista previa. */
function fechaCorta(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d}/${m}`
}

// ── Modal: crear / editar FRANJA (turno) ─────────────────────────────────────────

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
  const [esDescanso, setEsDescanso] = useState(!!turno?.es_descanso)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('empresa_id', empresaId)
    const ld = toastLoading(isEdit ? 'Guardando…' : 'Creando…')
    startTransition(async () => {
      const res = await guardarTurno(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar franja' : 'Nueva franja'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {turno && <input type="hidden" name="turno_id" value={turno.turno_id} />}
          <div className="modal-body">
            <div className="ter-form-grid">
              <div className="input-group ter-col-full">
                <label htmlFor="tur-nombre">Nombre <span className="required">*</span></label>
                <input className="input" id="tur-nombre" name="nombre" required autoFocus
                  defaultValue={turno?.nombre ?? ''} placeholder="Mañana, Tarde, Noche, Descanso…" />
              </div>

              <div className="input-group ter-col-full">
                <input type="hidden" name="es_descanso" value="0" />
                <label className="filtro-toggle">
                  <input type="checkbox" className="row-check" name="es_descanso" value="1"
                    checked={esDescanso} onChange={e => setEsDescanso(e.target.checked)} />
                  Es una franja de descanso
                </label>
                <span className="input-hint">
                  No suma horas ni cuenta como día trabajado. Sirve para marcar «libra» dentro
                  de un patrón con un color, en vez de dejar el hueco vacío.
                </span>
              </div>

              {!esDescanso && (
                <>
                  <div className="input-group ter-col-span-2">
                    <label htmlFor="tur-ini">Hora inicio</label>
                    <input className="input" id="tur-ini" name="hora_inicio" type="time"
                      defaultValue={formatHora(turno?.hora_inicio ?? null)} />
                  </div>
                  <div className="input-group ter-col-span-2">
                    <label htmlFor="tur-fin">Hora fin</label>
                    <input className="input" id="tur-fin" name="hora_fin" type="time"
                      defaultValue={formatHora(turno?.hora_fin ?? null)} />
                    <span className="input-hint">Si es menor que la de inicio, cruza la medianoche.</span>
                  </div>
                </>
              )}

              <div className="input-group ter-col-span-2">
                <label htmlFor="tur-color">Color</label>
                <select className="input" id="tur-color" name="color" defaultValue={turno?.color ?? TURNO_COLORS[0].value}>
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

// ── Modal: crear / editar PATRÓN de rotación (secuencia de franjas + roster) ──────

interface EmpleadoMin { empleado_id: string; nombre: string; apellidos: string | null; cargo: string | null }

function PatronModal({
  patron, empresaId, franjas, empleados, slotsIniciales, rosterInicial, onClose, onSaved,
}: {
  patron:         TurnoPatron | null
  empresaId:      string
  franjas:        Turno[]                        // franjas activas de la empresa
  empleados:      EmpleadoMin[]                  // activos de la empresa
  slotsIniciales: Map<number, string>            // posicion → turno_id
  rosterInicial:  Map<string, number>            // empleado_id → offset
  onClose:        () => void
  onSaved:        () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!patron

  const [nombre, setNombre] = useState(patron?.nombre ?? '')
  const [tipo,   setTipo]   = useState<TipoPatron>(patron?.tipo ?? 'SEMANAL')
  const [ancla,  setAncla]  = useState(patron?.fecha_ancla ?? hoyEnTz())
  // Secuencia por posición (posicion → turno_id, '' = descanso), para los tipos por semana.
  const [slots,  setSlots]  = useState<Map<number, string>>(slotsIniciales)
  // Ciclo N×M: N trabaja en una franja, M descansa.
  const derivarCiclo = () => {
    if (patron?.tipo !== 'CICLO') return { on: 2, off: 3, franja: franjas[0]?.turno_id ?? '' }
    let on = 0
    for (let i = 0; i < patron.longitud_dias; i++) { if (slotsIniciales.get(i)) on++; else break }
    return { on: on || 1, off: patron.longitud_dias - (on || 1), franja: slotsIniciales.get(0) ?? franjas[0]?.turno_id ?? '' }
  }
  const ini = derivarCiclo()
  const [cicloOn,     setCicloOn]     = useState(ini.on)
  const [cicloOff,    setCicloOff]    = useState(ini.off)
  const [cicloFranja, setCicloFranja] = useState(ini.franja)
  const [roster, setRoster] = useState<Map<string, number>>(rosterInicial)

  const longitud = tipo === 'CICLO' ? cicloOn + cicloOff : (TIPOS.find(t => t.value === tipo)!.longitud ?? 7)
  const anclaEfectiva = tipo === 'SEMANAL' ? REF_LUNES : ancla
  const pideOffset = tipo !== 'SEMANAL'   // en semanal el offset movería el día de la semana: no aplica

  function setSlot(pos: number, turnoId: string) {
    setSlots(prev => { const m = new Map(prev); if (turnoId) m.set(pos, turnoId); else m.delete(pos); return m })
  }
  function toggleMiembro(id: string) {
    setRoster(prev => { const m = new Map(prev); if (m.has(id)) m.delete(id); else m.set(id, 0); return m })
  }
  function setOffset(id: string, off: number) {
    setRoster(prev => { const m = new Map(prev); if (m.has(id)) m.set(id, off); return m })
  }

  /** Etiqueta de cada posición del ciclo según el tipo. */
  function etiquetaPos(pos: number): string {
    if (tipo === 'SEMANAL')  return DIAS[pos].largo
    if (tipo === 'CICLO')    return `Día ${pos + 1}`
    const dia = diaSemanaCorto(sumarDias(anclaEfectiva, pos))
    return `Sem ${Math.floor(pos / 7) + 1} · ${dia}`
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!nombre.trim()) { toastError('Ponle un nombre al patrón.'); return }
    if (tipo !== 'SEMANAL' && !/^\d{4}-\d{2}-\d{2}$/.test(ancla)) {
      toastError('Elige la fecha de inicio del ciclo.'); return
    }
    if (tipo === 'CICLO' && (cicloOn < 1 || !cicloFranja)) {
      toastError('En un ciclo N×M pon los días que trabaja y en qué franja.'); return
    }

    // Slots a guardar: [{ posicion, turno_id }] solo de las posiciones con franja.
    const slotArr = tipo === 'CICLO'
      ? Array.from({ length: cicloOn }, (_, i) => ({ posicion: i, turno_id: cicloFranja }))
      : Array.from(slots.entries())
          .filter(([pos, tid]) => tid && pos < longitud)
          .map(([pos, tid]) => ({ posicion: pos, turno_id: tid }))

    if (!slotArr.length) { toastError('El patrón no tiene ningún día de trabajo.'); return }

    const fd = new FormData()
    if (patron) fd.set('patron_id', patron.patron_id)
    fd.set('empresa_id', empresaId)
    fd.set('nombre', nombre.trim())
    fd.set('tipo', tipo)
    fd.set('fecha_ancla', anclaEfectiva)
    if (tipo === 'CICLO') fd.set('longitud_dias', String(longitud))
    fd.set('slots', JSON.stringify(slotArr))

    const miembros = Array.from(roster.entries()).map(([empleado_id, offset_ciclo]) => ({ empleado_id, offset_ciclo }))

    const ld = toastLoading(isEdit ? 'Guardando patrón…' : 'Creando patrón…')
    startTransition(async () => {
      const res = await guardarPatron(fd)
      if (!res.ok || !res.patron_id) { await ld.dismiss(); toastError(res.error ?? 'Error inesperado.'); return }
      const r2 = await guardarRoster(res.patron_id, miembros)
      await ld.dismiss()
      if (!r2.ok) { toastError(`Patrón guardado, pero el equipo no: ${r2.error}`); onSaved(); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar patrón de rotación' : 'Nuevo patrón de rotación'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body modal-body-wide">
            <div className="ter-form-grid">
              <div className="input-group ter-col-span-2">
                <label htmlFor="pat-nombre">Nombre <span className="required">*</span></label>
                <input className="input" id="pat-nombre" value={nombre} autoFocus
                  onChange={e => setNombre(e.target.value)} placeholder="Rotación cocina, 2×3 seguridad…" />
              </div>
              <div className="input-group ter-col-span-2">
                <label htmlFor="pat-tipo">Frecuencia</label>
                <select className="input" id="pat-tipo" value={tipo}
                  onChange={e => { setTipo(e.target.value as TipoPatron); setSlots(new Map()) }}>
                  {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <span className="input-hint">
                  {tipo === 'SEMANAL'   && 'La misma semana se repite: elige la franja de cada día.'}
                  {tipo === 'QUINCENAL' && 'Dos semanas que alternan (p. ej. una de mañanas y otra de tardes).'}
                  {tipo === 'MENSUAL'   && 'Cuatro semanas que rotan antes de repetirse.'}
                  {tipo === 'CICLO'     && 'Trabaja N días seguidos y descansa M, sin atarse a la semana.'}
                </span>
              </div>

              {tipo !== 'SEMANAL' && (
                <div className="input-group ter-col-span-2">
                  <label htmlFor="pat-ancla">Empieza el <span className="required">*</span></label>
                  <input className="input" id="pat-ancla" type="date" value={ancla}
                    onChange={e => setAncla(e.target.value)} />
                  <span className="input-hint">El primer día del ciclo. Desde aquí se cuenta la rotación.</span>
                </div>
              )}

              {/* ── Editor del ciclo ── */}
              {tipo === 'CICLO' ? (
                <div className="input-group ter-col-full">
                  <label>El ciclo</label>
                  <div className="turno-ciclo-nm">
                    <span>Trabaja</span>
                    <input className="input turno-nm-num" type="number" min={1} max={30} value={cicloOn}
                      onChange={e => setCicloOn(Math.max(1, Number(e.target.value) || 1))} aria-label="Días que trabaja" />
                    <span>días en</span>
                    <select className="input turno-nm-franja" value={cicloFranja} onChange={e => setCicloFranja(e.target.value)} aria-label="Franja del ciclo">
                      <option value="">Elige franja…</option>
                      {franjas.filter(f => !f.es_descanso).map(f => <option key={f.turno_id} value={f.turno_id}>{f.nombre}</option>)}
                    </select>
                    <span>y descansa</span>
                    <input className="input turno-nm-num" type="number" min={0} max={30} value={cicloOff}
                      onChange={e => setCicloOff(Math.max(0, Number(e.target.value) || 0))} aria-label="Días que descansa" />
                    <span>días.</span>
                  </div>
                  <span className="input-hint">Ciclo de {longitud} días. Cada persona puede arrancar desplazada (offset) para cubrir todos los días.</span>
                </div>
              ) : (
                <div className="input-group ter-col-full">
                  <label>La secuencia ({longitud} días)</label>
                  <div className="turno-ciclo-grid">
                    {Array.from({ length: longitud }, (_, pos) => (
                      <div className="turno-ciclo-slot" key={pos}>
                        <span className="turno-ciclo-dia">{etiquetaPos(pos)}</span>
                        <select className="input turno-ciclo-select" value={slots.get(pos) ?? ''}
                          onChange={e => setSlot(pos, e.target.value)} aria-label={`Franja del ${etiquetaPos(pos)}`}>
                          <option value="">Descanso</option>
                          {franjas.map(f => <option key={f.turno_id} value={f.turno_id}>{f.nombre}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Roster ── */}
              <div className="input-group ter-col-full">
                <label>Quién está en este patrón</label>
                {empleados.length === 0 ? (
                  <span className="input-hint">No hay trabajadores activos en esta empresa.</span>
                ) : (
                  <div className="turno-roster-lista">
                    {empleados.map(e => {
                      const activo = roster.has(e.empleado_id)
                      return (
                        <div className={`turno-roster-item${activo ? ' turno-roster-on' : ''}`} key={e.empleado_id}>
                          <label className="turno-roster-nombre">
                            <input type="checkbox" className="row-check" checked={activo}
                              onChange={() => toggleMiembro(e.empleado_id)} />
                            <span>{nombreDe(e)}{e.cargo ? ` · ${e.cargo}` : ''}</span>
                          </label>
                          {activo && pideOffset && (
                            <label className="turno-roster-offset">
                              Empieza el día
                              <input className="input turno-nm-num" type="number" min={0} max={longitud - 1}
                                value={roster.get(e.empleado_id) ?? 0}
                                onChange={ev => setOffset(e.empleado_id, Math.max(0, Number(ev.target.value) || 0))}
                                aria-label={`Offset de ${nombreDe(e)}`} />
                              del ciclo
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : isEdit ? 'Guardar cambios' : 'Crear patrón'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Página: Turnos ───────────────────────────────────────────────────────────────

export default function TurnosView({ data }: { data: TurnosPageData }) {
  const router = useRouter()
  const params = useSearchParams()

  const empresaUrl = params.get('empresa') ?? ''
  const empresaId  = data.empresas.some(e => e.empresa_id === empresaUrl)
    ? empresaUrl
    : (data.empresas[0]?.empresa_id ?? '')
  const busqueda   = (params.get('q') ?? '').trim().toLowerCase()

  function navegar(cambios: Record<string, string>) {
    const url = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(cambios)) { if (v) url.set(k, v); else url.delete(k) }
    router.replace(`?${url.toString()}`, { scroll: false })
  }

  const resumenEmpresa = [data.empresas.find(e => e.empresa_id === empresaId)?.nombre ?? '']
    .filter((x): x is string => Boolean(x))

  const [modalTurno,  setModalTurno]  = useState<Turno | null>(null)
  const [modalNuevoTurno, setModalNuevoTurno] = useState(false)
  const [modalPatron, setModalPatron] = useState<TurnoPatron | null>(null)
  const [modalNuevoPatron, setModalNuevoPatron] = useState(false)
  const [delTurno,    setDelTurno]    = useState<Turno | null>(null)
  const [delPatron,   setDelPatron]   = useState<TurnoPatron | null>(null)
  const [horizonte,   setHorizonte]   = useState(14)
  const [isPending,   startTransition] = useTransition()

  // La vista previa parte de «hoy» (zona del negocio). Se calcula tras montar para no
  // arriesgar un desajuste de hidratación en el cambio de día.
  const [hoy, setHoy] = useState<string | null>(null)
  useEffect(() => { setHoy(hoyEnTz()) }, [])

  const franjas = useMemo(
    () => data.turnos_catalogo.filter(t => t.empresa_id === empresaId),
    [data.turnos_catalogo, empresaId],
  )
  const franjasActivas = useMemo(() => franjas.filter(f => f.activo), [franjas])
  const franjaPorId    = useMemo(() => new Map(franjas.map(f => [f.turno_id, f])), [franjas])

  const patrones = useMemo(
    () => data.patrones.filter(p => p.empresa_id === empresaId),
    [data.patrones, empresaId],
  )
  const patronPorId = useMemo(() => new Map(patrones.map(p => [p.patron_id, p])), [patrones])

  // Secuencia resuelta de cada patrón: (Turno | null)[] por posición del ciclo.
  const slotsResueltos = useMemo(() => {
    const porPatron = new Map<string, (Turno | null)[]>()
    for (const p of patrones) porPatron.set(p.patron_id, new Array(p.longitud_dias).fill(null))
    for (const s of data.slots) {
      const arr = porPatron.get(s.patron_id)
      if (!arr || s.posicion < 0 || s.posicion >= arr.length) continue
      arr[s.posicion] = s.turno_id ? (franjaPorId.get(s.turno_id) ?? null) : null
    }
    return porPatron
  }, [patrones, data.slots, franjaPorId])

  const miembrosPorPatron = useMemo(() => {
    const m = new Map<string, number>()
    for (const mi of data.miembros) m.set(mi.patron_id, (m.get(mi.patron_id) ?? 0) + 1)
    return m
  }, [data.miembros])

  const empleadosEmpresa = useMemo(
    () => data.empleados.filter(e => e.estado === 'ACTIVO' && e.empresa_id === empresaId),
    [data.empleados, empresaId],
  )
  const empleadosVista = useMemo(
    () => empleadosEmpresa.filter(e =>
      !busqueda || nombreDe(e).toLowerCase().includes(busqueda) || (e.cargo ?? '').toLowerCase().includes(busqueda)),
    [empleadosEmpresa, busqueda],
  )
  // Roster por empleado (solo patrones ACTIVOS): la vista previa y los conflictos salen de aquí.
  const patronesPorEmpleado = useMemo(() => {
    const m = new Map<string, { patron_id: string; offset: number }[]>()
    for (const mi of data.miembros) {
      const p = patronPorId.get(mi.patron_id)
      if (!p || !p.activo) continue
      const arr = m.get(mi.empleado_id) ?? []
      arr.push({ patron_id: mi.patron_id, offset: mi.offset_ciclo })
      m.set(mi.empleado_id, arr)
    }
    return m
  }, [data.miembros, patronPorId])

  // Fechas del horizonte elegido, desde hoy.
  const fechas = useMemo(
    () => hoy ? Array.from({ length: horizonte }, (_, i) => sumarDias(hoy, i)) : [],
    [hoy, horizonte],
  )

  /** La(s) franja(s) de trabajo de un empleado en una fecha (sin descansos). */
  function franjasDe(empleadoId: string, fecha: string): Turno[] {
    const vistos = new Set<string>()
    const out: Turno[] = []
    for (const { patron_id, offset } of patronesPorEmpleado.get(empleadoId) ?? []) {
      const p = patronPorId.get(patron_id); if (!p) continue
      const pos = posicionEnCiclo({ longitud_dias: p.longitud_dias, fecha_ancla: p.fecha_ancla, slots: [] }, offset, fecha)
      const fr = slotsResueltos.get(patron_id)?.[pos] ?? null
      if (fr && !fr.es_descanso && !vistos.has(fr.turno_id)) { vistos.add(fr.turno_id); out.push(fr) }
    }
    return out
  }

  const gentePorFecha = useMemo(
    () => fechas.map(f => empleadosVista.filter(e => franjasDe(e.empleado_id, f).length > 0).length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fechas, empleadosVista, patronesPorEmpleado, slotsResueltos],
  )

  // ── Acciones ─────────────────────────────────────────────────────────────────
  function confirmarEliminarTurno() {
    if (!delTurno) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarTurno(delTurno.turno_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelTurno(null); return }
      setDelTurno(null); router.refresh()
    })
  }
  function toggleTurno(t: Turno) {
    const ld = toastLoading(t.activo ? 'Desactivando…' : 'Activando…')
    startTransition(async () => {
      const res = await alternarTurno(t.turno_id, !t.activo)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      router.refresh()
    })
  }
  function confirmarEliminarPatron() {
    if (!delPatron) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarPatron(delPatron.patron_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelPatron(null); return }
      setDelPatron(null); router.refresh()
    })
  }
  function togglePatron(p: TurnoPatron) {
    const ld = toastLoading(p.activo ? 'Desactivando…' : 'Activando…')
    startTransition(async () => {
      const res = await alternarPatron(p.patron_id, !p.activo)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      router.refresh()
    })
  }

  // Slots y roster iniciales para el modal de edición.
  function slotsDePatron(p: TurnoPatron): Map<number, string> {
    const m = new Map<number, string>()
    for (const s of data.slots) if (s.patron_id === p.patron_id && s.turno_id) m.set(s.posicion, s.turno_id)
    return m
  }
  function rosterDePatron(p: TurnoPatron): Map<string, number> {
    const m = new Map<string, number>()
    for (const mi of data.miembros) if (mi.patron_id === p.patron_id) m.set(mi.empleado_id, mi.offset_ciclo)
    return m
  }

  /** Resumen de la secuencia de un patrón para la tabla (franjas distintas, en orden). */
  function resumenSecuencia(p: TurnoPatron): string {
    const arr = slotsResueltos.get(p.patron_id) ?? []
    const nombres = arr.filter((f): f is Turno => !!f && !f.es_descanso).map(f => f.nombre)
    const unicos = Array.from(new Set(nombres))
    if (!unicos.length) return '—'
    return unicos.slice(0, 3).join(' · ') + (unicos.length > 3 ? '…' : '')
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Turnos</h1>
            <IaTouchpoint tipo="rrhh" descripcion="una revisión de tu cuadrante" />
          </div>
          <p className="page-subtitle">
            Define las <strong>franjas horarias</strong> y los <strong>patrones de rotación</strong> del personal.
          </p>
        </div>
        <div className="tes-header-actions">
          <ExportarMenu
            opciones={[
              { clave: 'turnos_cuadrante', etiqueta: 'Cuadrante',
                detalle: 'El cuadrante que estás viendo, para imprimir',
                filtro: { empresa_id: empresaId }, resumen: resumenEmpresa },
              { clave: 'turnos', etiqueta: 'Catálogo de franjas',
                detalle: 'Las franjas definidas, con sus horas',
                filtro: { empresa_id: empresaId }, resumen: resumenEmpresa },
            ]}
          />
          <button className="btn btn-secondary" onClick={() => setModalNuevoTurno(true)} disabled={!empresaId}>
            <Plus size={14} strokeWidth={2.5} /> Nueva franja
          </button>
          <button className="btn btn-primary" onClick={() => setModalNuevoPatron(true)}
            disabled={!empresaId || franjasActivas.length === 0}
            title={franjasActivas.length === 0 ? 'Crea al menos una franja horaria primero.' : undefined}>
            <Repeat size={14} strokeWidth={2.5} /> Nuevo patrón
          </button>
        </div>
      </div>

      {data.empresas.length === 0 && (
        <PrerequisitoAviso acciones={[{ label: 'Crear empresa', href: '/portal/empresas' }]}>
          Para crear turnos necesitas <strong>una empresa</strong>.
        </PrerequisitoAviso>
      )}

      <div className="ter-toolbar">
        {data.empresas.length > 1 && (
          <select className="input ter-filter-select" value={empresaId}
            aria-label="Empresa del cuadrante"
            onChange={e => navegar({ empresa: e.target.value })}>
            {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
          </select>
        )}
        <input className="input ter-filter-select" type="search" defaultValue={busqueda}
          placeholder="Buscar trabajador…" aria-label="Buscar trabajador en el cuadrante"
          onChange={e => navegar({ q: e.target.value })} />
      </div>

      {/* ── Franjas horarias ── */}
      <div className="card card-table rrhh-card-gap">
        <div className="ter-card-head"><span className="ter-form-section-title">Franjas horarias</span></div>
        {franjas.length === 0 ? (
          <div className="mon-empty">
            <Clock size={36} strokeWidth={1} opacity={0.2} />
            <p>Crea las franjas de esta empresa (p. ej. Mañana 08:00–14:00) para poder montar patrones de rotación.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Franja</th><th>Horario</th><th className="col-num">Horas</th><th className="col-actions"></th></tr>
              </thead>
              <tbody>
                {franjas.map(t => (
                  <tr key={t.turno_id}>
                    <td data-label="Franja">
                      <div className="turno-name">
                        {t.color && !t.es_descanso && <span className="turno-dot" style={{ '--turno-color': t.color } as React.CSSProperties} />}
                        <strong>{t.nombre}</strong>
                        {t.es_descanso && <span className="badge badge-neutral">Descanso</span>}
                        {!t.activo && <span className="badge badge-neutral">Desactivada</span>}
                      </div>
                    </td>
                    <td data-label="Horario" className="text-sm-muted">{horario(t)}</td>
                    <td data-label="Horas" className="col-num tes-monto-cell">
                      {t.es_descanso ? '—' : formatHoras(horasDeTurno(t))}
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => setModalTurno(t)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                        <button className="row-actions-item" onClick={() => toggleTurno(t)} disabled={isPending}>
                          <Power size={15} strokeWidth={2} /> {t.activo ? 'Desactivar' : 'Activar'}
                        </button>
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

      {/* ── Patrones de rotación ── */}
      <div className="card card-table rrhh-card-gap">
        <div className="ter-card-head"><span className="ter-form-section-title">Patrones de rotación</span></div>
        {patrones.length === 0 ? (
          <div className="mon-empty">
            <Repeat size={36} strokeWidth={1} opacity={0.2} />
            <p>{franjasActivas.length === 0
              ? 'Primero crea una franja horaria; después podrás montar un patrón (semanal, quincenal, mensual o un ciclo N×M) y meter a su gente.'
              : 'Crea un patrón: elige la frecuencia (2×3, semana A/B…), la secuencia de franjas y quién rota en él.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Patrón</th><th>Frecuencia</th><th>Secuencia</th>
                  <th className="col-num">Personas</th><th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {patrones.map(p => (
                  <tr key={p.patron_id}>
                    <td data-label="Patrón">
                      <div className="turno-name">
                        <Repeat size={14} strokeWidth={2} className="text-muted" />
                        <strong>{p.nombre}</strong>
                        {!p.activo && <span className="badge badge-neutral">Desactivado</span>}
                      </div>
                    </td>
                    <td data-label="Frecuencia" className="text-sm-muted">
                      {TIPO_LABEL[p.tipo]} · {p.longitud_dias} días
                    </td>
                    <td data-label="Secuencia" className="text-sm-muted">{resumenSecuencia(p)}</td>
                    <td data-label="Personas" className="col-num">{miembrosPorPatron.get(p.patron_id) ?? 0}</td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => setModalPatron(p)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                        <button className="row-actions-item" onClick={() => togglePatron(p)} disabled={isPending}>
                          <Power size={15} strokeWidth={2} /> {p.activo ? 'Desactivar' : 'Activar'}
                        </button>
                        <button className="row-actions-item row-actions-item-danger"
                          onClick={() => setDelPatron(p)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Vista previa del cuadrante ── */}
      <div className="card card-table">
        <div className="ter-card-head turno-preview-head">
          <span className="ter-form-section-title">Cuadrante</span>
          <div className="turno-horizonte" role="tablist" aria-label="Horizonte del cuadrante">
            {HORIZONTES.map(h => (
              <button key={h.value} type="button" role="tab" aria-selected={horizonte === h.value}
                className={`turno-horizonte-btn${horizonte === h.value ? ' turno-horizonte-on' : ''}`}
                onClick={() => setHorizonte(h.value)}>{h.label}</button>
            ))}
          </div>
        </div>
        {empleadosVista.length === 0 || patrones.length === 0 || !hoy ? (
          <div className="mon-empty">
            <Users size={36} strokeWidth={1} opacity={0.2} />
            <p>{!hoy ? 'Cargando…'
              : patrones.length === 0 ? 'Crea un patrón de rotación y mete a su gente para ver el cuadrante.'
              : busqueda ? 'Ningún trabajador coincide con la búsqueda.'
              : 'No hay trabajadores activos en esta empresa.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table table-sticky-first turno-grid">
              <thead>
                <tr>
                  <th className="turno-grid-emp">Empleado</th>
                  {fechas.map(f => (
                    <th key={f} className="col-center turno-preview-col">
                      <span className="turno-preview-dia">{diaSemanaCorto(f)}</span>
                      <span className="turno-preview-fecha">{fechaCorta(f)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {empleadosVista.map(e => {
                  // ¿Está en algún patrón activo? Si lo está, un día sin franja es un
                  // DESCANSO planificado y se marca «Libre»; si no, es que no rota y va en
                  // blanco. Es la misma distinción «libra» vs «sin asignar» de las franjas.
                  const enPatron = (patronesPorEmpleado.get(e.empleado_id)?.length ?? 0) > 0
                  return (
                  <tr key={e.empleado_id}>
                    <td className="turno-grid-emp" data-label="Empleado">
                      <strong>{nombreDe(e)}</strong>
                      {e.cargo && <div className="text-sm-muted">{e.cargo}</div>}
                    </td>
                    {fechas.map(f => {
                      const frs = franjasDe(e.empleado_id, f)
                      const conflicto = frs.length > 1
                      const fr = frs[0]
                      return (
                        <td key={f} className={`col-center turno-preview-cell${conflicto ? ' turno-preview-conflicto' : ''}`}
                          data-label={fechaCorta(f)}
                          title={conflicto ? `Conflicto: ${frs.map(x => x.nombre).join(' y ')}` : fr?.nombre ?? (enPatron ? 'Descanso' : 'Sin patrón')}>
                          {fr ? (
                            <span className="turno-preview-franja" style={fr.color ? ({ '--turno-color': fr.color } as React.CSSProperties) : undefined}>
                              {fr.color && <span className="turno-dot" />}
                              {fr.nombre}
                            </span>
                          ) : enPatron ? (
                            <span className="turno-preview-libre">Libre</span>
                          ) : <span className="text-faint">·</span>}
                          {conflicto && <span className="turno-preview-warn">!</span>}
                        </td>
                      )
                    })}
                  </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="turno-grid-emp"><strong>Gente ese día</strong></td>
                  {gentePorFecha.map((n, i) => (
                    <td key={fechas[i]} className="col-center">
                      <strong className={n === 0 ? 'text-faint' : undefined}>{n}</strong>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Modales ── */}
      {(modalNuevoTurno || modalTurno) && (
        <TurnoModal turno={modalTurno} empresaId={empresaId}
          onClose={() => { setModalNuevoTurno(false); setModalTurno(null) }}
          onSaved={() => { setModalNuevoTurno(false); setModalTurno(null); router.refresh() }} />
      )}
      {(modalNuevoPatron || modalPatron) && (
        <PatronModal
          key={modalPatron?.patron_id ?? 'nuevo'}
          patron={modalPatron}
          empresaId={empresaId}
          franjas={franjasActivas}
          empleados={empleadosEmpresa}
          slotsIniciales={modalPatron ? slotsDePatron(modalPatron) : new Map()}
          rosterInicial={modalPatron ? rosterDePatron(modalPatron) : new Map()}
          onClose={() => { setModalNuevoPatron(false); setModalPatron(null) }}
          onSaved={() => { setModalNuevoPatron(false); setModalPatron(null); router.refresh() }} />
      )}
      {delTurno && (
        <div className="modal-backdrop open">
          <div className="modal modal-sm" role="dialog" aria-modal>
            <div className="modal-header">
              <h2 className="modal-title">Eliminar franja</h2>
              <button type="button" className="modal-close" onClick={() => setDelTurno(null)}><X size={16} strokeWidth={2} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-body-text">
                ¿Eliminar la franja <strong>{delTurno.nombre}</strong>? Los patrones que la usaban
                dejarán ese día en descanso. Si solo quieres dejar de usarla, <strong>desactívala</strong>.
              </p>
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
      {delPatron && (
        <div className="modal-backdrop open">
          <div className="modal modal-sm" role="dialog" aria-modal>
            <div className="modal-header">
              <h2 className="modal-title">Eliminar patrón</h2>
              <button type="button" className="modal-close" onClick={() => setDelPatron(null)}><X size={16} strokeWidth={2} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-body-text">
                ¿Eliminar el patrón <strong>{delPatron.nombre}</strong>? Se quita su secuencia y su
                equipo. Si solo quieres pausarlo, <strong>desactívalo</strong>.
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setDelPatron(null)}>Cancelar</button>
              <button type="button" className="btn btn-danger" onClick={confirmarEliminarPatron} disabled={isPending}>
                {isPending ? <><span className="spinner spinner-sm" /> Eliminando…</> : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
