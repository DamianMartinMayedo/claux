'use client'

import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import { useState, useTransition, useMemo } from 'react'
import { useRouter, useSearchParams }        from 'next/navigation'
import {
  guardarTurno,
  eliminarTurno,
  alternarTurno,
  guardarAsignaciones,
  type CambioAsignacion,
  type Turno,
  type TurnosPageData,
} from '@/app/actions/portal/rrhh'
import { Clock, CopyPlus, Eraser, Pencil, Plus, Power, Save, Trash2, X } from 'lucide-react'
import ExportarMenu from '@/components/portal/ExportarMenu'
import BulkBar      from '@/components/portal/BulkBar'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { horasDeTurno, totalHorasSemana, formatHoras, cruzaMedianoche } from '@/lib/rrhh/turnos'

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
  // Un turno de descanso no tiene horario: los campos se ocultan en vez de quedarse
  // ahí pidiendo un dato que después se descarta.
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
          <h2 className="modal-title">{isEdit ? 'Editar turno' : 'Nuevo turno'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {turno && <input type="hidden" name="turno_id" value={turno.turno_id} />}
          <div className="modal-body">
            <div className="ter-form-grid">
              <div className="input-group ter-col-full">
                <label htmlFor="tur-nombre">Nombre <span className="required">*</span></label>
                <input className="input" id="tur-nombre" name="nombre" required autoFocus
                  defaultValue={turno?.nombre ?? ''} placeholder="Mañana, Tarde, Libre…" />
              </div>

              <div className="input-group ter-col-full">
                {/* El hidden gemelo permite distinguir «desmarcado» de «no venía»: un
                    checkbox sin marcar no se envía. */}
                <input type="hidden" name="es_descanso" value="0" />
                <label className="filtro-toggle">
                  <input type="checkbox" className="row-check" name="es_descanso" value="1"
                    checked={esDescanso} onChange={e => setEsDescanso(e.target.checked)} />
                  Es día de descanso
                </label>
                <span className="input-hint">
                  No suma horas ni cuenta como día trabajado. Sirve para que en la rejilla
                  se vea la diferencia entre <strong>libra</strong> y <strong>sin asignar</strong>.
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

// ── Página: Turnos ───────────────────────────────────────────────────────────────

export default function TurnosView({ data }: { data: TurnosPageData }) {
  const router = useRouter()
  const params = useSearchParams()

  // La empresa vive en la URL como el resto del portal: una recarga —o que se caiga la
  // conexión— ya no devuelve el cuadrante a la primera empresa de la lista.
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

  const [modalTurno, setModalTurno] = useState<Turno | null>(null)
  const [modalNuevo, setModalNuevo] = useState(false)
  const [delTurno,   setDelTurno]   = useState<Turno | null>(null)
  const [isPending,  startTransition] = useTransition()

  const turnos = useMemo(
    () => data.turnos_catalogo.filter(t => t.empresa_id === empresaId),
    [data.turnos_catalogo, empresaId],
  )
  // Un turno desactivado no se ofrece para asignar, pero sí se sigue viendo donde ya
  // estaba: desactivar no es borrar el pasado.
  const asignables = useMemo(() => turnos.filter(t => t.activo), [turnos])
  const turnoPorId = useMemo(() => new Map(turnos.map(t => [t.turno_id, t])), [turnos])

  const empleados = useMemo(
    () => data.empleados.filter(e =>
      e.estado === 'ACTIVO' && e.empresa_id === empresaId &&
      (!busqueda || nombreDe(e).toLowerCase().includes(busqueda)
                 || (e.cargo ?? '').toLowerCase().includes(busqueda))),
    [data.empleados, empresaId, busqueda],
  )

  // ── La rejilla, en estado local ────────────────────────────────────────────────
  // Antes cada `<select>` disparaba una acción, un toast y un `router.refresh()`
  // completo: rellenar la semana de diez personas eran setenta viajes en 3G. Ahora se
  // edita en el navegador y se guarda una vez, con el botón diciendo cuántos van.
  const guardadas = useMemo(() => {
    const m = new Map<string, string>()   // `${empleado_id}-${dia}` → turno_id
    for (const a of data.asignaciones) m.set(`${a.empleado_id}-${a.dia_semana}`, a.turno_id)
    return m
  }, [data.asignaciones])

  const [pendientes, setPendientes] = useState<Map<string, string>>(new Map())
  const valorDe = (empleadoId: string, dia: number) => {
    const k = `${empleadoId}-${dia}`
    return pendientes.has(k) ? pendientes.get(k)! : (guardadas.get(k) ?? '')
  }
  function poner(cambios: { empleadoId: string; dia: number; turnoId: string }[]) {
    setPendientes(prev => {
      const m = new Map(prev)
      for (const c of cambios) {
        const k = `${c.empleadoId}-${c.dia}`
        // Volver al valor que ya estaba guardado deja de ser un cambio pendiente: el
        // contador del botón tiene que decir la verdad.
        if ((guardadas.get(k) ?? '') === c.turnoId) m.delete(k)
        else m.set(k, c.turnoId)
      }
      return m
    })
  }

  function guardar() {
    if (!pendientes.size) return
    const cambios: CambioAsignacion[] = Array.from(pendientes.entries()).map(([k, turno_id]) => {
      const i = k.lastIndexOf('-')
      return { empleado_id: k.slice(0, i), dia_semana: Number(k.slice(i + 1)), turno_id }
    })
    const ld = toastLoading('Guardando el cuadrante…')
    startTransition(async () => {
      const res = await guardarAsignaciones(cambios)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(cambios.length === 1 ? 'Cuadrante guardado' : `${cambios.length} cambios guardados`)
      setPendientes(new Map())
      router.refresh()
    })
  }

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

  // ── Totales ────────────────────────────────────────────────────────────────────
  // Las horas de la semana por persona, y cuánta gente hay cada día. Es la versión
  // barata de la cobertura y responde a la pregunta que un negocio se hace de verdad:
  // «¿el sábado por la noche tengo a alguien?».
  const horasDe = (empleadoId: string) => totalHorasSemana(
    DIAS.map(d => turnoPorId.get(valorDe(empleadoId, d.n)) ?? null))
  const gentePorDia = DIAS.map(d => empleados.filter(e => {
    const t = turnoPorId.get(valorDe(e.empleado_id, d.n))
    return !!t && !t.es_descanso
  }).length)

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Turnos</h1>
            <IaTouchpoint tipo="rrhh" descripcion="una revisión de tu cuadrante" />
          </div>
          <p className="page-subtitle">
            Define los turnos de cada empresa y organiza la <strong>semana tipo</strong> del personal.
          </p>
        </div>
        <div className="tes-header-actions">
          {/* Dos descargas, y el CUADRANTE va primero porque es lo que la pantalla está
              enseñando. Antes solo se ofrecía el catálogo —tres filas: nombre, horas,
              empresa— mientras el dueño miraba la rejilla: el botón bajaba una cosa
              distinta de la que tenía delante. */}
          <ExportarMenu
            opciones={[
              { clave: 'turnos_cuadrante', etiqueta: 'Cuadrante semanal',
                detalle: 'La rejilla que estás viendo, para imprimir',
                filtro: { empresa_id: empresaId }, resumen: resumenEmpresa },
              { clave: 'turnos', etiqueta: 'Catálogo de turnos',
                detalle: 'Los turnos definidos, con sus horas',
                filtro: { empresa_id: empresaId }, resumen: resumenEmpresa },
            ]}
          />
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

      <div className="ter-toolbar">
        {data.empresas.length > 1 && (
          <select className="input ter-filter-select" value={empresaId}
            aria-label="Empresa del cuadrante"
            onChange={e => { setPendientes(new Map()); navegar({ empresa: e.target.value }) }}>
            {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
          </select>
        )}
        <input className="input ter-filter-select" type="search" defaultValue={busqueda}
          placeholder="Buscar trabajador…" aria-label="Buscar trabajador en el cuadrante"
          onChange={e => navegar({ q: e.target.value })} />
      </div>

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
                <tr><th>Turno</th><th>Horario</th><th className="col-num">Horas</th><th className="col-actions"></th></tr>
              </thead>
              <tbody>
                {turnos.map(t => (
                  <tr key={t.turno_id}>
                    <td data-label="Turno">
                      <div className="turno-name">
                        {t.color && !t.es_descanso && <span className="turno-dot" style={{ '--turno-color': t.color } as React.CSSProperties} />}
                        <strong>{t.nombre}</strong>
                        {t.es_descanso && <span className="badge badge-neutral">Descanso</span>}
                        {!t.activo && <span className="badge badge-neutral">Desactivado</span>}
                      </div>
                    </td>
                    <td data-label="Horario" className="text-sm-muted">{horario(t)}</td>
                    <td data-label="Horas" className="col-num tes-monto-cell">
                      {t.es_descanso ? '—' : formatHoras(horasDeTurno(t))}
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => setModalTurno(t)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                        {/* Desactivar en vez de borrar: un turno que ya no se usa pero
                            que sigue en el cuadrante no es un turno que haya que borrar. */}
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

      {/* Rejilla semanal */}
      <div className="card card-table">
        <div className="ter-card-head"><span className="ter-form-section-title">Semana tipo</span></div>
        {empleados.length === 0 ? (
          <div className="mon-empty">
            <Clock size={36} strokeWidth={1} opacity={0.2} />
            <p>{busqueda
              ? 'Ningún trabajador coincide con la búsqueda.'
              : 'No hay empleados activos en esta empresa para planificar.'}</p>
          </div>
        ) : asignables.length === 0 ? (
          <div className="mon-empty">
            <Clock size={36} strokeWidth={1} opacity={0.2} />
            <p>Crea (o activa) al menos un turno arriba para empezar a asignarlo por día.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table turno-grid">
              <thead>
                <tr>
                  <th className="turno-grid-emp">Empleado</th>
                  {DIAS.map(d => (
                    <th key={d.n}>
                      <div className="turno-col-head">
                        <span>{d.label}</span>
                        {/* Rellenar una columna entera de un clic: sin esto, un negocio
                            de 39 personas son 273 desplegables a mano. */}
                        <button type="button" className="turno-col-btn"
                          title={`Poner «${asignables[0]?.nombre}» a todos el ${d.largo}`}
                          aria-label={`Poner «${asignables[0]?.nombre}» a todos el ${d.largo}`}
                          onClick={() => {
                            const t = asignables[0]
                            if (!t) return
                            poner(empleados.map(e => ({ empleadoId: e.empleado_id, dia: d.n, turnoId: t.turno_id })))
                          }}>
                          <CopyPlus size={13} strokeWidth={2} />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="col-num">Horas</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {empleados.map(e => (
                  <tr key={e.empleado_id}>
                    <td className="turno-grid-emp" data-label="Empleado">
                      <strong>{nombreDe(e)}</strong>
                      {e.cargo && <div className="text-sm-muted">{e.cargo}</div>}
                    </td>
                    {DIAS.map(d => {
                      const actual = valorDe(e.empleado_id, d.n)
                      const t      = turnoPorId.get(actual)
                      const sucio  = pendientes.has(`${e.empleado_id}-${d.n}`)
                      return (
                        <td className={`turno-cell${sucio ? ' turno-cell-sucia' : ''}`} key={d.n} data-label={d.label}>
                          <div className="turno-cell-wrap"
                            style={t?.color && !t.es_descanso ? ({ '--turno-color': t.color } as React.CSSProperties) : undefined}>
                            {t?.color && !t.es_descanso && <span className="turno-dot" />}
                            <select className="input turno-grid-select" value={actual}
                              onChange={ev => poner([{ empleadoId: e.empleado_id, dia: d.n, turnoId: ev.target.value }])}
                              aria-label={`Turno de ${nombreDe(e)} el ${d.largo}`}>
                              {/* «—» significaba a la vez «libra» y «nadie le ha puesto
                                  nada». Ahora lo dice. */}
                              <option value="">Sin asignar</option>
                              {asignables.map(x => <option key={x.turno_id} value={x.turno_id}>{x.nombre}</option>)}
                              {/* El turno ya asignado se ofrece aunque esté desactivado:
                                  si no, abrir la rejilla lo borraría de su celda. */}
                              {t && !t.activo && <option value={t.turno_id}>{t.nombre} (desactivado)</option>}
                            </select>
                          </div>
                        </td>
                      )
                    })}
                    <td data-label="Horas" className="col-num tes-monto-cell">{formatHoras(horasDe(e.empleado_id))}</td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item"
                          onClick={() => {
                            const t = asignables[0]
                            if (!t) return
                            poner(DIAS.map(d => ({ empleadoId: e.empleado_id, dia: d.n, turnoId: t.turno_id })))
                          }}>
                          <CopyPlus size={15} strokeWidth={2} /> Poner «{asignables[0]?.nombre}» toda la semana
                        </button>
                        <button className="row-actions-item"
                          onClick={() => poner(DIAS.map(d => ({ empleadoId: e.empleado_id, dia: d.n, turnoId: '' })))}>
                          <Eraser size={15} strokeWidth={2} /> Limpiar la fila
                        </button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="turno-grid-emp"><strong>Gente ese día</strong></td>
                  {gentePorDia.map((n, i) => (
                    <td key={DIAS[i].n} data-label={DIAS[i].label} className="col-num">
                      <strong className={n === 0 ? 'text-faint' : undefined}>{n}</strong>
                    </td>
                  ))}
                  <td className="col-num"></td>
                  <td className="col-actions"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Barra de guardado: la misma pieza que la de acciones en lote, persistente
          mientras haya cambios sin escribir. Sin diálogo del navegador al salir: con
          conexión mala eso confunde más de lo que ayuda, y el botón ya está a la vista. */}
      <BulkBar
        count={pendientes.size}
        onClear={() => setPendientes(new Map())}
        limpiarLabel="Descartar"
        etiqueta={<span>
          <strong>{pendientes.size}</strong> cambio{pendientes.size === 1 ? '' : 's'} sin guardar
        </span>}
      >
        <button className="btn btn-primary btn-sm" onClick={guardar} disabled={isPending}>
          {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : <><Save size={14} strokeWidth={2} /> Guardar cuadrante</>}
        </button>
      </BulkBar>

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
              <p className="modal-body-text">
                ¿Eliminar el turno <strong>{delTurno.nombre}</strong>? Se quitará de todas las
                asignaciones semanales. Si solo quieres dejar de usarlo, <strong>desactívalo</strong>:
                así conserva el cuadrante como está.
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
    </div>
  )
}
