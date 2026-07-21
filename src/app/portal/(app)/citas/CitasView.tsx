'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  guardarServicio, eliminarServicio,
  guardarRecurso, eliminarRecurso, importarPersonalRRHH, importarServiciosCatalogo,
  crearCitaManual, cambiarEstadoCita, cambiarEstadoCitasEnLote,
  guardarBotConfigCitas, eliminarBotConfigCitas, toggleActivoBotCitas, toggleIaBotCitas, guardarConfirmacionCitas,
  obtenerSlotsCita, obtenerDiasDisponiblesCita,
  type CitasPageData, type Servicio, type Recurso, type CitaConDetalle, type SlotCita, type DiaDisponible,
  type ResultadoLote, type ServicioCatalogo,
} from '@/app/actions/portal/citas'
import { guardarSlug } from '@/app/actions/portal/reservas'
import Tabs from '@/components/Tabs'
import CierresSection from '@/components/portal/CierresSection'
import { RowActions } from '@/components/portal/RowActions'
import BulkBar from '@/components/portal/BulkBar'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { usePagination, TablePagination } from '@/components/TablePagination'
import ReglasReservaSection from '@/components/portal/ReglasReservaSection'
import IaBotBanner from '@/components/portal/IaBotBanner'
import { type EstadoReserva } from '@/lib/reservas/estado'
import { opcionesCon } from '@/components/portal/form-helpers'
import { CalendarDays, Check, Copy, Download, Eye, Info, Pencil, Plus, Power, PowerOff, Search, Trash2, UserX, X } from 'lucide-react'

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
// El precio se muestra con SU moneda, nunca con un «$» fijo: la moneda sale siempre de
// las del cliente. Sin moneda (ficha vieja anterior a la mig. 119) se muestra el número
// pelado antes que mentir con un símbolo.
function formatPrecio(p: number | null, moneda: string | null): string {
  if (p == null) return '—'
  return `${p.toFixed(2)}${moneda ? ` ${moneda}` : ''}`
}

// ── Modal: servicio ─────────────────────────────────────────────────────────

function ServicioModal({ servicio, etiqueta, data, onClose, onSaved }: {
  servicio: Servicio | null
  etiqueta: string
  data: CitasPageData
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!servicio

  const [nombre,  setNombre]  = useState(servicio?.nombre ?? '')
  const [precio,  setPrecio]  = useState(servicio?.precio?.toString() ?? '')
  const [moneda,  setMoneda]  = useState(servicio?.moneda ?? data.monedas[0] ?? '')
  const [productoId] = useState(servicio?.producto_id ?? '')
  // Al crear se marca; al editar no, porque tocar un nombre no puede dar de alta una
  // ficha comercial por su cuenta.
  const [enCatalogo, setEnCatalogo] = useState(!servicio)

  const monedaOrigen = servicio?.moneda ?? ''
  const precioOrigen = servicio?.precio ?? 0
  const cambiaMoneda = isEdit && !!moneda && !!monedaOrigen && moneda !== monedaOrigen
  const factor       = cambiaMoneda ? data.tasas[`${monedaOrigen}__${moneda}`] : undefined

  // La moneda que ya tiene la ficha se ofrece aunque esté desactivada: si no, desactivar
  // una moneda dejaría sus servicios sin poder guardarse.
  const opcionesMoneda = opcionesCon(data.monedas, servicio?.moneda)

  // Cambiar de moneda VACÍA el precio, igual que el salario en RRHH: en otra moneda es
  // otro precio y lo pone el dueño. La tasa se ofrece como atajo, nunca se impone —
  // un importe convertido a ojo se guarda sin mirar, y un campo vacío se ve.
  function handleMoneda(nueva: string) {
    setMoneda(nueva)
    if (!isEdit) return
    setPrecio(nueva === monedaOrigen ? (servicio?.precio?.toString() ?? '') : '')
  }
  function aplicarTasa() {
    if (factor) setPrecio((precioOrigen * factor).toFixed(2))
  }

  // Traer los que YA existen en el catálogo es trabajo del importador (botón propio de la
  // pestaña), no de este modal: aquí se crea uno nuevo. Lo único que queda del catálogo
  // es a dónde va lo que se cree — la casilla de abajo.
  const yaVinculado = data.catalogo.find(c => c.producto_id === productoId)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (servicio) fd.set('servicio_id', servicio.servicio_id)
    fd.set('producto_id', productoId)
    fd.set('crear_en_catalogo', enCatalogo && !productoId ? '1' : '')
    startTransition(async () => {
      const res = await guardarServicio(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      if (res.aviso) toastError(res.aviso)
      else toastSuccess(isEdit ? `${etiqueta} actualizado.` : `${etiqueta} creado.`)
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
                <label htmlFor="srv-nombre">Nombre <span className="required">*</span></label>
                <input className="input" id="srv-nombre" name="nombre" required autoFocus={!isEdit}
                  value={nombre} onChange={e => setNombre(e.target.value)}
                  placeholder="Corte de pelo, Consulta…" />
              </div>
              <div className="input-group ter-col-span-2">
                <label htmlFor="srv-duracion">Duración (min) <span className="required">*</span></label>
                <input className="input" id="srv-duracion" name="duracion_minutos" type="number" min="5" step="5" required
                  defaultValue={servicio?.duracion_minutos ?? 30} />
                <span className="input-hint">Tiempo que ocupa cada cita.</span>
              </div>
              <div className="input-group ter-col-span-2">
                <label htmlFor="srv-precio">Precio</label>
                <input className="input" id="srv-precio" name="precio" type="number" min="0" step="0.01"
                  value={precio} onChange={e => setPrecio(e.target.value)} placeholder="Opcional" />
              </div>
              <div className="input-group ter-col-span-2">
                <label htmlFor="srv-moneda">Moneda {precio !== '' && <span className="required">*</span>}</label>
                {opcionesMoneda.length === 0 ? (
                  <>
                    <input className="input input-static" readOnly value="Sin monedas activas" />
                    <span className="input-hint">Crea una moneda en Monedas y Tasas primero.</span>
                  </>
                ) : (
                  <>
                    <select className="input" id="srv-moneda" name="moneda" required={precio !== ''}
                      value={moneda} onChange={e => handleMoneda(e.target.value)}>
                      <option value="" disabled>Selecciona…</option>
                      {opcionesMoneda.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <span className="input-hint">En la que cobras esta cita.</span>
                  </>
                )}
              </div>

              {cambiaMoneda && precioOrigen > 0 && (
                <div className="moneda-cambio">
                  <div className="moneda-cambio-nota">
                    <Info size={14} strokeWidth={2} />
                    <span>
                      Antes costaba {precioOrigen.toFixed(2)} {monedaOrigen}. Escribe el precio en {moneda}
                      {factor && <> o <button type="button" className="aplicar-tasa-btn" onClick={aplicarTasa}>
                        usa la tasa ({(precioOrigen * factor).toFixed(2)} {moneda})</button></>}.
                    </span>
                  </div>
                </div>
              )}
              <div className="input-group ter-col-full">
                <label className="cita-chk-item">
                  <input type="checkbox" name="activo" value="true" defaultChecked={servicio?.activo ?? true} />
                  Activo (visible para reservar)
                </label>
              </div>

              {/* Con catálogo contratado, lo que se crea aquí puede nacer también allí. No
                  se prohíbe crear en Citas —es un módulo que funciona solo—, pero se evita
                  acabar con dos listas que se separan. Sin el módulo, nada de esto existe. */}
              {productoId ? (
                <div className="moneda-cambio">
                  <div className="moneda-cambio-nota">
                    <Info size={14} strokeWidth={2} />
                    <span>
                      Vinculado a tu catálogo{yaVinculado ? <> como <strong>{yaVinculado.codigo} · {yaVinculado.nombre}</strong></> : ''}.
                      El precio y el nombre de aquí son los de la agenda; facturar sigue usando el del catálogo.
                    </span>
                  </div>
                </div>
              ) : data.catalogo_activo && (
                <div className="input-group ter-col-full">
                  <label className="cita-chk-item">
                    <input type="checkbox" checked={enCatalogo} onChange={e => setEnCatalogo(e.target.checked)} />
                    Añadirlo también a mi catálogo de Servicios
                  </label>
                  <span className="input-hint">
                    Lo crea de una vez como servicio facturable y los deja vinculados, para no
                    llevar dos listas. Desmárcalo si este {etiqueta.toLowerCase()} solo se agenda y no se vende suelto.
                  </span>
                </div>
              )}
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

// ── Modal: importar servicios del catálogo ────────────────────────────────────

/**
 * Importación SELECTIVA: el negocio ve su catálogo entero y marca lo que agenda. Antes
 * esto era un desplegable dentro del alta y había que crear los servicios de uno en uno.
 *
 * La duración se pide aquí, fila a fila: `products` no la guarda, así que darles 30
 * minutos a todos por defecto sería agendar mal en silencio.
 */
function ImportarServiciosModal({ catalogo, etiquetaPlural, onClose, onSaved }: {
  catalogo:       ServicioCatalogo[]
  etiquetaPlural: string
  onClose:        () => void
  onSaved:        () => void
}) {
  const [isPending, startTransition] = useTransition()
  const disponibles = catalogo.filter(c => !c.ya_importado)

  const [marcados,  setMarcados]  = useState<Set<string>>(() => new Set(disponibles.map(c => c.producto_id)))
  const [duraciones, setDuraciones] = useState<Record<string, string>>(
    () => Object.fromEntries(disponibles.map(c => [c.producto_id, '30'])))

  const todos = marcados.size === disponibles.length && disponibles.length > 0

  function toggle(id: string) {
    setMarcados(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function toggleTodos() {
    setMarcados(todos ? new Set() : new Set(disponibles.map(c => c.producto_id)))
  }

  function importar() {
    const items = [...marcados].map(producto_id => ({
      producto_id,
      duracion_minutos: parseInt(duraciones[producto_id] ?? '30', 10) || 30,
    }))
    startTransition(async () => {
      const res = await importarServiciosCatalogo(items)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(`${res.importados ?? 0} ${etiquetaPlural.toLowerCase()} importado(s) del catálogo.`)
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Importar del catálogo</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="input-hint mb-3">
            Marca los que se agendan y dales su duración. Se traen con su precio y quedan
            vinculados a la ficha del catálogo.
          </p>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th className="col-center">
                    <input type="checkbox" checked={todos} onChange={toggleTodos}
                      aria-label="Marcar todos" disabled={disponibles.length === 0} />
                  </th>
                  <th>Servicio</th>
                  <th className="col-num">Precio</th>
                  <th className="col-num">Duración</th>
                </tr>
              </thead>
              <tbody>
                {catalogo.map(c => {
                  const tarifa = Object.entries(c.precios ?? {}).find(([, v]) => v != null && Number(v) > 0)
                  const marcado = marcados.has(c.producto_id)
                  return (
                    <tr key={c.producto_id} className={c.ya_importado ? 'row-inactive' : undefined}>
                      <td data-label="Importar" className="col-center">
                        <input type="checkbox" checked={marcado} disabled={c.ya_importado}
                          onChange={() => toggle(c.producto_id)}
                          aria-label={`Importar ${c.nombre}`} />
                      </td>
                      <td data-label="Servicio">
                        <strong className="text-sm-bold">{c.nombre}</strong>
                        <div className="table-cell-secondary">
                          {c.codigo}{c.ya_importado && ' · ya importado'}
                        </div>
                      </td>
                      <td data-label="Precio" className="col-num">
                        {tarifa ? `${Number(tarifa[1]).toFixed(2)} ${tarifa[0]}` : '—'}
                      </td>
                      <td data-label="Duración" className="col-num">
                        {c.ya_importado ? <span className="text-xs-muted">—</span> : (
                          <input className="input cita-dur-input" type="number" min="5" step="5"
                            value={duraciones[c.producto_id] ?? '30'} disabled={!marcado}
                            aria-label={`Duración de ${c.nombre} en minutos`}
                            onChange={e => setDuraciones(d => ({ ...d, [c.producto_id]: e.target.value }))} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={importar}
            disabled={isPending || marcados.size === 0}>
            {isPending
              ? <><span className="spinner spinner-sm" /> Importando…</>
              : `Importar ${marcados.size}`}
          </button>
        </div>
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
  const [showImportar, setShowImportar] = useState(false)
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

  // Host de la plataforma para el enlace público (dinámico, no hardcodeado): se
  // deriva de NEXT_PUBLIC_SITE_URL. La copia del enlace usa el origin real.
  const host = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')

  // Estos dos formularios se resincronizan cuando el servidor manda datos nuevos (tras
  // guardar + router.refresh()). Se ajusta DURANTE el render comparando con lo último
  // visto — el patrón de React para estado derivado de props. Con `useEffect` + setState
  // se pinta primero un fotograma con el valor viejo y luego se re-renderiza en cascada.
  // Y la comparación va por VALOR, no por identidad del objeto: el `[data.bot_config]`
  // de antes se disparaba en cada refresco del servidor y podía pisar lo que el dueño
  // estuviera escribiendo en el campo del token.
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

  // ── Selección múltiple (cambiar estado en lote) ──
  const citaIds = useMemo(() => citas.map(c => c.reserva_id), [citas])
  const sel = useRowSelection(citaIds)
  const [loteAccion, setLoteAccion] = useState<{ estado: EstadoReserva; label: string } | null>(null)
  useEffect(() => { sel.clear() }, [activeTab, search, filtroDesde, filtroHasta, filtroRecurso, filtroEstado]) // eslint-disable-line react-hooks/exhaustive-deps
  const plural = (n: number) => n === 1 ? '' : 's'

  function ejecutarLote(estado: EstadoReserva) {
    startTransition(async () => {
      const r: ResultadoLote = await cambiarEstadoCitasEnLote(sel.selectedIds, estado)
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
          {/* Importar es su propio botón, no un desplegable escondido dentro del alta:
              con el catálogo delante se ve qué falta por traer y se marca de una vez. */}
          {activeTab === 'servicios' && data.catalogo.some(c => !c.ya_importado) && (
            <button className="btn btn-secondary" onClick={() => setShowImportar(true)} disabled={isPending}>
              <Download size={14} strokeWidth={2.5} /> Importar del catálogo
            </button>
          )}
          {activeTab === 'servicios' && (
            <button className="btn btn-primary" onClick={() => { setEditServicio(null); setShowServicio(true) }}>
              <Plus size={14} strokeWidth={2.5} /> Nuevo {servicioNombre.toLowerCase()}
            </button>
          )}
        </div>
      </div>

      <Tabs
        ariaLabel="Secciones de citas"
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'agenda', label: 'Agenda' },
          { id: 'recursos', label: et.recurso_pl, count: data.recursos.length },
          { id: 'servicios', label: servicioPlural, count: data.servicios.length },
          { id: 'configuracion', label: 'Configuración' },
        ]}
      />

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
                  <th className="col-check">
                    <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                  </th>
                  <th>Fecha</th><th>Hora</th><th>{servicioNombre}</th><th>{et.recurso}</th>
                  <th>Cliente</th><th>Estado</th><th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {citaItems.map(c => (
                  <tr key={c.reserva_id} className="table-row-clickable" onClick={() => setDetalleCita(c)}>
                    <td className="col-check" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="row-check"
                        checked={sel.isSelected(c.reserva_id)}
                        onChange={() => sel.toggle(c.reserva_id)}
                        aria-label={`Seleccionar cita de ${c.nombre_cliente}`} />
                    </td>
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
                      <RowActions>
                        <button className="row-actions-item" onClick={() => setDetalleCita(c)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                        {(c.estado === 'PENDIENTE' || c.estado === 'CONFIRMADA') && (
                          <>
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
                          </>
                        )}
                      </RowActions>
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
            {data.catalogo.some(c => !c.ya_importado) && (
              <button className="btn btn-secondary btn-sm" onClick={() => setShowImportar(true)}>
                <Download size={14} strokeWidth={2.5} /> Traerlos de mi catálogo
              </button>
            )}
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
                    <td data-label="Precio" className="col-num tes-monto-cell cita-precio">{formatPrecio(s.precio, s.moneda)}</td>
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
      {showImportar && (
        <ImportarServiciosModal catalogo={data.catalogo} etiquetaPlural={servicioPlural}
          onClose={() => setShowImportar(false)}
          onSaved={() => { setShowImportar(false); router.refresh() }} />
      )}
      {showServicio && (
        <ServicioModal servicio={editServicio} etiqueta={servicioNombre} data={data}
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

      {activeTab === 'agenda' && (
        <BulkBar count={sel.count} onClear={sel.clear}>
          <button className="btn btn-secondary btn-sm" disabled={isPending}
            onClick={() => setLoteAccion({ estado: 'CONFIRMADA', label: 'Confirmar' })}>
            <Check size={14} strokeWidth={2} /> Confirmar
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
          title={`¿${loteAccion.label} ${sel.count} cita${plural(sel.count)}?`}
          body="Solo se aplica a las que admitan el cambio; el resto se omite. Se notificará a los clientes por Telegram cuando proceda."
          confirmLabel={loteAccion.label}
          danger={loteAccion.estado !== 'CONFIRMADA'}
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
