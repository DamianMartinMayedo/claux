'use client'

import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  guardarServicio, eliminarServicio,
  guardarRecurso, eliminarRecurso, importarPersonalRRHH, importarServiciosCatalogo,
  crearCitaManual, modificarCita, cambiarEstadoCita, cambiarEstadoCitasEnLote,
  guardarAusencia, eliminarAusencia,
  guardarBotConfigCitas, eliminarBotConfigCitas, toggleActivoBotCitas, toggleIaBotCitas, guardarConfirmacionCitas,
  obtenerSlotsCita, obtenerDiasDisponiblesCita,
  type CitasPageData, type Servicio, type Recurso, type CitaConDetalle, type SlotCita, type DiaDisponible,
  type ResultadoLote, type ServicioCatalogo, type Ausencia,
} from '@/app/actions/portal/citas'
import { guardarSlug } from '@/app/actions/portal/agenda-comun'
import Tabs from '@/components/Tabs'
import CierresSection from '@/components/portal/CierresSection'
import { RowActions } from '@/components/portal/RowActions'
import FormHelp from '@/components/portal/FormHelp'
import BulkBar from '@/components/portal/BulkBar'
import HeaderCheck from '@/components/portal/HeaderCheck'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden } from '@/components/TableSort'
import TablaCargando                     from '@/components/portal/TablaCargando'
import ReglasReservaSection from '@/components/portal/ReglasReservaSection'
import IaBotBanner from '@/components/portal/IaBotBanner'
import QrEnlace from '@/components/portal/QrEnlace'
import BotDiagnostico from '@/components/portal/BotDiagnostico'
import AvisarCliente from '@/components/portal/AvisarCliente'
import HistorialClienteLinea from '@/components/portal/HistorialCliente'
import {
  ESTADO_LABEL, ESTADO_BADGE, ESTADOS_DESHACIBLES, type EstadoReserva,
} from '@/lib/reservas/estados'
import { opcionesCon } from '@/components/portal/form-helpers'
import { CalendarDays, Check, Copy, Download, Eye, Info, Pencil, Plus, Power, PowerOff, Trash2, Undo2, UserX, X } from 'lucide-react'
import ExportarMenu from '@/components/portal/ExportarMenu'
import Filtros from '@/components/portal/Filtros'
import AvisoTope from '@/components/portal/AvisoTope'
import { filtroExport, resumenDe, type Filtro } from '@/lib/filtros'
import { type PresetRango } from '@/lib/listados'
import Link from 'next/link'
import { hoyEnTz, sumarDias } from '@/lib/fecha-tz'
import { DIAS_CIERRE_AUTO } from '@/lib/reservas/estados'

// ── Constantes ────────────────────────────────────────────────────────────────

/**
 * Presets del rango de la agenda: miran al FUTURO.
 *
 * Una cita es un compromiso pendiente, no un histórico, así que el juego de los listados de
 * Contabilidad («Últimos 3 meses») no sirve. «Mes pasado» se queda para repasar no-shows.
 */
const PRESETS_CITAS: PresetRango[] = ['prox_30', 'prox_3_meses', 'mes', 'mes_pasado', 'todo']

const CANAL_LABEL: Record<string, string> = { web: 'Web', bot: 'Bot', manual: 'Manual' }
const DIA_LABEL: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' }
const MEDIAS_HORAS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

// ── Helpers ───────────────────────────────────────────────────────────────────

// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: a partir de las 20:00
// `toISOString()` ya da la fecha de mañana, así que el defecto de un `type=date` se
// adelantaba un día cada noche. Una sola fuente: `lib/fecha-tz.ts`.
function hoyISO(): string { return hoyEnTz() }
// CIT-7: iba con `toISOString()`, que es UTC — después de las 20:00 de Cuba el chip
// «Mañana» etiquetaba pasado mañana. La fecha del negocio sale de `hoyEnTz`.
function mananaISO(): string { return sumarDias(hoyISO(), 1) }
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
    const ld = toastLoading(isEdit ? 'Guardando…' : 'Creando…')
    startTransition(async () => {
      const res = await guardarServicio(fd)
      await ld.dismiss()
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
                <div className="form-label-with-help">
                  <label htmlFor="srv-duracion">Duración (min) <span className="required">*</span></label>
                  <FormHelp text="Tiempo que ocupa cada cita." label="Qué es la duración" />
                </div>
                <input className="input" id="srv-duracion" name="duracion_minutos" type="number" min="5" step="5" required
                  defaultValue={servicio?.duracion_minutos ?? 30} />
              </div>
              <div className="input-group ter-col-span-2">
                {/* La confusión natural es creer que esto alarga la cita. No: el cliente
                    sigue leyendo «30 min», y el hueco siguiente empieza más tarde. */}
                <div className="form-label-with-help">
                  <label htmlFor="srv-margen">Margen después (min)</label>
                  <FormHelp text="Para limpiar o preparar. No se le enseña al cliente ni cambia el precio." label="Qué es el margen después" />
                </div>
                <input className="input" id="srv-margen" name="margen_minutos" type="number" min="0" step="5"
                  defaultValue={servicio?.margen_minutos ?? 0} />
              </div>
              <div className="input-group ter-col-span-2">
                <label htmlFor="srv-precio">Precio</label>
                <input className="input" id="srv-precio" name="precio" type="number" min="0" step="any"
                  value={precio} onChange={e => setPrecio(e.target.value)} placeholder="Opcional" />
              </div>
              <div className="input-group ter-col-span-2">
                <div className="form-label-with-help">
                  <label htmlFor="srv-moneda">Moneda {precio !== '' && <span className="required">*</span>}</label>
                  <FormHelp text="En la que cobras esta cita." label="Qué es la moneda de la cita" />
                </div>
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
    const ld = toastLoading('Importando…')
    startTransition(async () => {
      const res = await importarServiciosCatalogo(items)
      await ld.dismiss()
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
                        <strong className="text-sm-bold cell-clamp">{c.nombre}</strong>
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
  // CIT-3: dos tramos por día. `recurso_horarios` guarda una fila por tramo, así que
  // el «tramo n» de un día es su n-ésima fila ordenada por hora de inicio.
  const tramosDe = (dia: number) =>
    (recurso?.horarios ?? [])
      .filter(h => h.dia_semana === dia)
      .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
  const horaDe = (dia: number, tramo: 0 | 1, campo: 'hora_inicio' | 'hora_fin') =>
    tramosDe(dia)[tramo]?.[campo] ?? ''

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (recurso) fd.set('recurso_id', recurso.recurso_id)
    const ld = toastLoading(isEdit ? 'Guardando…' : 'Creando…')
    startTransition(async () => {
      const res = await guardarRecurso(fd)
      await ld.dismiss()
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
                <div className="form-label-with-help">
                  <label>{etiquetaSrv}s que atiende</label>
                  <FormHelp text="Sin selección = atiende todos los servicios." label="Cómo funciona la selección de servicios" />
                </div>
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
              </div>

              <div className="input-group ter-col-full">
                <div className="form-label-with-help">
                  <label>Horario semanal</label>
                  <FormHelp text="Deja un día en blanco si no atiende. El segundo tramo es para jornada partida (mañana y tarde); si trabajas seguido, déjalo vacío." label="Cómo rellenar el horario semanal" />
                </div>
                <div className="cita-hor-grid">
                  {[1, 2, 3, 4, 5, 6, 7].map(d => (
                    <div key={d} className="cita-hor-row">
                      <span className="cita-hor-day">{DIA_LABEL[d]}</span>
                      <select className="input" name={`hor_${d}_inicio`} defaultValue={horaDe(d, 0, 'hora_inicio')}>
                        <option value="">—</option>
                        {MEDIAS_HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <span className="cita-hor-sep">a</span>
                      <select className="input" name={`hor_${d}_fin`} defaultValue={horaDe(d, 0, 'hora_fin')}>
                        <option value="">—</option>
                        {MEDIAS_HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                      {/* Segundo tramo (jornada partida): sin él no hay pausa de comida
                          — o se ofrecen citas a las 13:30 o se cierra el día entero. */}
                      <span className="cita-hor-sep">y</span>
                      <select className="input" name={`hor_${d}_inicio2`} defaultValue={horaDe(d, 1, 'hora_inicio')}>
                        <option value="">—</option>
                        {MEDIAS_HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <span className="cita-hor-sep">a</span>
                      <select className="input" name={`hor_${d}_fin2`} defaultValue={horaDe(d, 1, 'hora_fin')}>
                        <option value="">—</option>
                        {MEDIAS_HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
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

        {/* Ausencias (CIT-4). Fuera del <form> de arriba a propósito: son su propio
            alta/baja inmediata, y anidar formularios no es válido en HTML.
            Solo al editar: hace falta que el profesional exista. */}
        {isEdit && recurso && (
          <AusenciasRecurso recurso={recurso} etiquetaRec={etiquetaRec} onCambio={onSaved} />
        )}
      </div>
    </div>
  )
}

// ── Ausencias de un profesional (CIT-4) ───────────────────────────────────────
//
// Vive DENTRO de su ficha, no en la pantalla de cierres del negocio: un cierre para
// la barbería entera y las vacaciones de un barbero no son la misma cosa, y meterlas
// juntas es justo la confusión que se está corrigiendo.

function AusenciasRecurso({ recurso, etiquetaRec, onCambio }: {
  recurso:     Recurso
  etiquetaRec: string
  onCambio:    () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [borrar, setBorrar] = useState<Ausencia | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    fd.set('recurso_id', recurso.recurso_id)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarAusencia(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Ausencia guardada.')
      form.reset()
      onCambio()
    })
  }

  function doBorrar() {
    if (!borrar) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarAusencia(borrar.ausencia_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setBorrar(null); return }
      toastSuccess('Ausencia eliminada.')
      setBorrar(null); onCambio()
    })
  }

  return (
    <div className="modal-body res-conf-pad-top">
      <h3 className="card-title">Días libres y ausencias</h3>
      <span className="input-hint">
        Vacaciones, baja o un día suelto. Ese {etiquetaRec.toLowerCase()} deja de ofrecer
        horas esos días; el resto del negocio sigue igual.
      </span>

      {recurso.ausencias.length > 0 && (
        <div className="table-wrapper">
          <table className="table">
            <thead><tr><th>Desde</th><th>Hasta</th><th>Motivo</th><th className="col-actions"></th></tr></thead>
            <tbody>
              {recurso.ausencias.map(a => (
                <tr key={a.ausencia_id}>
                  <td data-label="Desde">{formatFecha(a.fecha_desde)}</td>
                  <td data-label="Hasta">{formatFecha(a.fecha_hasta)}</td>
                  <td data-label="Motivo" className="text-sm-muted">{a.motivo ?? '—'}</td>
                  <td className="col-actions">
                    <button type="button" className="ter-action-btn" aria-label="Eliminar ausencia"
                      onClick={() => setBorrar(a)} disabled={isPending}>
                      <Trash2 size={15} strokeWidth={2} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="ter-form-grid res-conf-pad-top">
          <div className="input-group ter-col-span-2">
            <label>Desde <span className="required">*</span></label>
            <input className="input" name="fecha_desde" type="date" required />
          </div>
          <div className="input-group ter-col-span-2">
            <div className="form-label-with-help">
              <label>Hasta</label>
              <FormHelp text="En blanco = solo ese día." label="Cómo indicar un solo día" />
            </div>
            <input className="input" name="fecha_hasta" type="date" />
          </div>
          <div className="input-group ter-col-span-2">
            <label>Motivo</label>
            <input className="input" name="motivo" placeholder="Vacaciones, médico…" />
          </div>
        </div>
        <div className="res-form-submit">
          <button type="submit" className="btn btn-secondary" disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Añadir ausencia'}
          </button>
        </div>
      </form>

      {borrar && (
        <ConfirmDialog
          title="¿Eliminar esta ausencia?"
          body={`Volverá a ofrecer horas del ${formatFecha(borrar.fecha_desde)} al ${formatFecha(borrar.fecha_hasta)}.`}
          confirmLabel="Eliminar" danger
          onCancel={() => setBorrar(null)}
          onConfirm={doBorrar}
        />
      )}
    </div>
  )
}

// ── Modal: cita manual (nueva o movida) ───────────────────────────────────────
//
// El mismo modal hace las dos cosas (CIT-1). Mover una cita —«¿me lo pasas a las
// 5?»— es el caso más frecuente de una peluquería y no existía: había que CANCELAR,
// con su aviso de cancelación al cliente, y crear otra. Se reutiliza este porque la
// parte cara es la misma: elegir servicio, profesional y un hueco REAL.

function NuevaCitaModal({ data, cita, onClose, onSaved }: {
  data: CitasPageData
  /** Presente = se está moviendo esa cita, no creando una nueva. */
  cita?: CitaConDetalle | null
  onClose: () => void
  onSaved: () => void
}) {
  const editando = !!cita
  const [isPending, startTransition] = useTransition()
  const [servicioId, setServicioId] = useState(cita?.servicio_id ?? '')
  const [recursoId,  setRecursoId]  = useState(cita?.recurso_id  ?? '')
  const [fecha,      setFecha]      = useState(cita?.fecha ?? hoyISO())
  const [hora,       setHora]       = useState(cita?.hora?.substring(0, 5) ?? '')
  const [slots,      setSlots]      = useState<SlotCita[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [dias,       setDias]       = useState<DiaDisponible[]>([])  // próximos días con hueco
  const [loadingDias, setLoadingDias] = useState(false)
  // Lo que la base rechazó pero el dueño puede saltarse (Fase 3).
  const [forzar,     setForzar]     = useState<{ motivo: string; datos: FormData } | null>(null)

  const recursosActivos = data.recursos.filter(r => r.activo)
  // Recursos que prestan el servicio elegido (sin asignaciones = presta todos)
  const recursosParaServicio = useMemo(() =>
    !servicioId ? recursosActivos
      : recursosActivos.filter(r => r.servicio_ids.length === 0 || r.servicio_ids.includes(servicioId)),
    [recursosActivos, servicioId])

  // Al elegir servicio + recurso, buscar los próximos días con hueco y saltar al
  // primero (no depende de la fecha → no pisa la que el usuario elija después).
  // MOVIENDO una cita no se salta: la primera carga borraría la fecha que ya tiene.
  const saltoInicial = useRef(!editando)
  useEffect(() => {
    if (!servicioId || !recursoId) { setDias([]); return }
    let cancel = false
    setLoadingDias(true)
    obtenerDiasDisponiblesCita(data.client_id, servicioId, recursoId).then(ds => {
      if (cancel) return
      setDias(ds)
      if (ds.length > 0 && saltoInicial.current) setFecha(ds[0].fecha)
      saltoInicial.current = true
      setLoadingDias(false)
    }).catch(() => { if (!cancel) setLoadingDias(false) })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioId, recursoId])

  // Cargar huecos libres cuando hay servicio + recurso + fecha. La hora se limpia al
  // cambiar de contexto salvo la primera vez de una cita que se está moviendo: la suya
  // no sale como hueco libre (la ocupa ella misma) y hay que conservarla.
  const conservarHora = useRef(editando)
  useEffect(() => {
    if (!servicioId || !recursoId || !fecha) { setSlots([]); setHora(''); return }
    let cancel = false
    setLoadingSlots(true)
    if (conservarHora.current) conservarHora.current = false
    else setHora('')
    obtenerSlotsCita(data.client_id, servicioId, recursoId, fecha).then(s => {
      if (cancel) return
      setSlots(s); setLoadingSlots(false)
    }).catch(() => { if (!cancel) { setSlots([]); setLoadingSlots(false) } })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioId, recursoId, fecha])

  // Los huecos del día, MÁS la hora que la cita ya ocupa (que no sale como libre
  // justamente porque la ocupa ella): sin esto, abrir «Mover» dejaría el selector en
  // blanco y parecería que su propia hora no existe.
  const horasLibres = useMemo(() => {
    const propia = editando && cita?.fecha === fecha ? [cita.hora?.substring(0, 5) ?? ''] : []
    return Array.from(new Set([...slots.map(s => s.hora), ...propia].filter(Boolean))).sort()
  }, [slots, editando, cita, fecha])

  function enviar(fd: FormData, forzado: boolean) {
    const ld = toastLoading(editando ? 'Guardando…' : 'Creando…')
    startTransition(async () => {
      const res = cita
        ? await modificarCita(cita.reserva_id, fd, forzado)
        : await crearCitaManual(fd, forzado)
      await ld.dismiss()
      if (!res.ok) {
        // El sistema avisa, no bloquea: lo que decide el dueño se le pregunta.
        if (res.forzable) { setForzar({ motivo: res.error ?? '', datos: fd }); return }
        toastError(res.error ?? 'Error inesperado.'); return
      }
      const hecho = editando ? 'Cita actualizada' : 'Cita creada'
      toastSuccess(res.avisos?.length ? `${hecho} — ${res.avisos.join(' ')}` : `${hecho}.`)
      onSaved()
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!hora) { toastError('Selecciona una hora disponible.'); return }
    enviar(new FormData(e.currentTarget), false)
  }

  const sinDatos = recursosActivos.length === 0 || data.servicios.filter(s => s.activo).length === 0

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        {forzar && (
          <ConfirmDialog
            title={editando ? '¿La guardas igualmente?' : '¿La añades igualmente?'}
            body={`${forzar.motivo} Es tu negocio: puedes ${editando ? 'guardarla' : 'meterla'} de todas formas y quedará marcada como forzada.`}
            confirmLabel={editando ? 'Guardar igualmente' : 'Añadir igualmente'}
            onCancel={() => setForzar(null)}
            onConfirm={() => { const fd = forzar.datos; setForzar(null); enviar(fd, true) }}
          />
        )}
        <div className="modal-header">
          <h2 className="modal-title">{editando ? 'Mover cita' : 'Nueva cita'}</h2>
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
                  <input className="input" name="nombre_cliente" required placeholder="Nombre del cliente"
                    defaultValue={cita?.nombre_cliente ?? ''} />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Teléfono</label>
                  <input className="input" name="telefono" placeholder="+53 5…" defaultValue={cita?.telefono ?? ''} />
                </div>
                <div className="input-group ter-col-full">
                  <label>Notas</label>
                  <input className="input" name="notas" placeholder="Detalles, preferencias…" defaultValue={cita?.notas ?? ''} />
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || sinDatos}>
              {isPending
                ? <><span className="spinner spinner-sm" /> {editando ? 'Guardando…' : 'Creando…'}</>
                : editando ? 'Guardar cambios' : 'Crear cita'}
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
    ATENDIDA:   `¿Dar por atendida la cita de ${cita.nombre_cliente}?`,
    CANCELADA:  `¿Cancelar la cita de ${cita.nombre_cliente}?`,
    // Deshacer: la hora vuelve a estar ocupada, y pudo cogerla otro mientras tanto.
    PENDIENTE:  `¿Recuperar la cita de ${cita.nombre_cliente}? Vuelve a ocupar esa hora, así que puede fallar si ya la ha cogido otra persona.`,
    CADUCADA:   '',
  }
  const positivo = nuevoEstado === 'CONFIRMADA' || nuevoEstado === 'ATENDIDA' || nuevoEstado === 'PENDIENTE'
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{nuevoEstado === 'PENDIENTE' ? 'Recuperar cita' : `${ESTADO_LABEL[nuevoEstado]} cita`}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body"><p className="modal-body-text">{mensajes[nuevoEstado]}</p></div>
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

// ── Modal: detalle de cita ─────────────────────────────────────────────────────

function CitaDetalleModal({ cita, onClose, onCambiarEstado, onMover, puedeEditar }: {
  cita: CitaConDetalle
  onClose: () => void
  onCambiarEstado: (a: EstadoReserva) => void
  onMover: () => void
  puedeEditar: boolean
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
            {/* En una peluquería, saber que este cliente viene desde hace dos años —o
                que faltó las dos últimas veces— es la mitad del valor del módulo. */}
            <HistorialClienteLinea telefono={cita.telefono} />
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
        {puedeEditar && (
        <div className="modal-footer">
          {/* «Editar» existía solo en Reservas: en Citas había que cancelar y rehacer. */}
          {(cita.estado === 'PENDIENTE' || cita.estado === 'CONFIRMADA') && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onMover}><Pencil size={14} strokeWidth={2} /> Mover</button>
          )}
          {cita.estado === 'PENDIENTE' && (
            <>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onCambiarEstado('CONFIRMADA')}><Check size={14} strokeWidth={2} /> Confirmar</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onCambiarEstado('RECHAZADA')}><X size={14} strokeWidth={2} /> Rechazar</button>
            </>
          )}
          {cita.estado === 'CONFIRMADA' && (
            <>
              <button type="button" className="btn btn-success btn-sm" onClick={() => onCambiarEstado('ATENDIDA')}><Check size={14} strokeWidth={2} /> Atendió</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCambiarEstado('NO_SHOW')}><UserX size={14} strokeWidth={2} /> No asistió</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onCambiarEstado('CANCELADA')}><Trash2 size={14} strokeWidth={2} /> Cancelar</button>
            </>
          )}
        </div>
        )}
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

export default function CitasView({ data, puedeEditar, children }: { data: CitasPageData; puedeEditar: boolean; children?: React.ReactNode }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const et = data.etiquetas

  const [activeTab, setActiveTab] = useState<'agenda' | 'recursos' | 'servicios' | 'configuracion'>('agenda')

  const [showNueva,    setShowNueva]    = useState(false)
  /** Cita que se está moviendo (CIT-1). Reusa el modal del alta. */
  const [moverCita,    setMoverCita]    = useState<CitaConDetalle | null>(null)
  const [detalleCita,  setDetalleCita]  = useState<CitaConDetalle | null>(null)
  const [cambioEstado, setCambioEstado] = useState<{ cita: CitaConDetalle; a: EstadoReserva } | null>(null)

  const [showServicio, setShowServicio] = useState(false)
  const [editServicio, setEditServicio] = useState<Servicio | null>(null)
  const [showImportar, setShowImportar] = useState(false)
  const [delServicio,  setDelServicio]  = useState<Servicio | null>(null)

  const [showRecurso, setShowRecurso] = useState(false)
  const [editRecurso, setEditRecurso] = useState<Recurso | null>(null)
  const [delRecurso,  setDelRecurso]  = useState<Recurso | null>(null)

  // Los filtros viven en la URL, como en el resto del portal (`skills/ui/SKILL.md` §3.3).
  // El rango y la búsqueda los aplica LA CONSULTA; el servidor devuelve cuál usó.
  const params = useSearchParams()
  const search = data.q
  const filtroRecurso = params.get('recurso') ?? ''
  const filtroEstado  = params.get('estado')  ?? ''

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

  /**
   * LA DECLARACIÓN. De aquí salen la barra, el `FiltroExport` de la descarga y el texto del
   * desplegable. `escalado` en los dos: mientras la agenda quepa entera, el navegador filtra
   * al instante y da el MISMO resultado; en cuanto hay filas sin traer, sube al servidor.
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
      // El «recurso» es quien atiende (`recursos`). Viaja a la descarga como `categoria`,
      // que es la clave con la que el registro de exportación filtra esa columna.
      clave: 'categoria', param: 'recurso', label: `Todos los ${et.recurso_pl.toLowerCase()}`,
      valor: filtroRecurso,
      rotulo: et.recurso,
      widget: 'select', donde: 'escalado',
      ocultarSi: data.recursos.length === 0,
      opciones: data.recursos.map(r => ({ valor: r.recurso_id, label: r.nombre })),
    },
  ], [filtroEstado, filtroRecurso, data.recursos, et])

  // El rango y la búsqueda ya los aplicó la CONSULTA: aquí solo quedan los dos escalados.
  const citas = useMemo(() => data.citas.filter(c => {
    if (filtroRecurso && c.recurso_id !== filtroRecurso) return false
    if (filtroEstado  && c.estado     !== filtroEstado)  return false
    return true
  }), [data.citas, filtroRecurso, filtroEstado])

  // Ordenar va ANTES de paginar: al revés se ordenaría solo la página visible.
  const ordCitas = useOrden(citas, {
    fecha:    { label: 'Fecha',        valor: c => c.fecha },
    hora:     { label: 'Hora',         valor: c => c.hora },
    servicio: { label: et.servicio,    valor: c => c.servicio_nombre },
    recurso:  { label: et.recurso,     valor: c => c.recurso_nombre },
    cliente:  { label: 'Cliente',      valor: c => c.nombre_cliente },
    estado:   { label: 'Estado',       valor: c => ESTADO_LABEL[c.estado] },
  }, { clave: 'fecha' })

  const { pageItems: citaItems, ...citaPag } = usePagination(ordCitas.filas)

  const ordRecursos = useOrden(data.recursos, {
    nombre:    { label: 'Nombre',           valor: r => r.nombre },
    tipo:      { label: 'Tipo',             valor: r => r.tipo },
    servicios: { label: `${et.servicio}s`,  valor: r => r.servicio_ids.length },
    horario:   { label: 'Horario',          valor: r => r.horarios.length },
    estado:    { label: 'Estado',           valor: r => r.activo },
  })

  const ordServicios = useOrden(data.servicios, {
    nombre:   { label: 'Nombre',   valor: s => s.nombre },
    duracion: { label: 'Duración', valor: s => s.duracion_minutos },
    precio:   { label: 'Precio',   valor: s => s.precio },
    estado:   { label: 'Estado',   valor: s => s.activo },
  })
  const [cargando, setCargando] = useState(false)

  // ── Selección múltiple (cambiar estado en lote) ──
  const citaIds = useMemo(() => citas.map(c => c.reserva_id), [citas])
  const sel = useRowSelection(citaIds)
  const [loteAccion, setLoteAccion] = useState<{ estado: EstadoReserva; label: string } | null>(null)
  useEffect(() => { sel.clear() }, [activeTab, search, data.rango.desde, data.rango.hasta, filtroRecurso, filtroEstado]) // eslint-disable-line react-hooks/exhaustive-deps
  const plural = (n: number) => n === 1 ? '' : 's'

  function ejecutarLote(estado: EstadoReserva) {
    const ld = toastLoading('Procesando…')
    startTransition(async () => {
      const r: ResultadoLote = await cambiarEstadoCitasEnLote(sel.selectedIds, estado)
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

  // Lo de hoy lo cuenta la consulta (U3): antes salía de `data.citas`, o sea del rango
  // cargado, y cambiar el rango a un mes pasado dejaba la cabecera a cero.
  const { pendientes: pendientesHoy, confirmadas: confirmadasHoy, total: totalHoy } = data.hoy
  const ayer = sumarDias(hoy, -1)

  function doCambiarEstado() {
    if (!cambioEstado) return
    const ld = toastLoading('Procesando…')
    startTransition(async () => {
      const res = await cambiarEstadoCita(cambioEstado.cita.reserva_id, cambioEstado.a)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setCambioEstado(null); return }
      toastSuccess(`Cita ${ESTADO_LABEL[cambioEstado.a].toLowerCase()}.`)
      setCambioEstado(null); router.refresh()
    })
  }
  function doEliminarServicio() {
    if (!delServicio) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarServicio(delServicio.servicio_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelServicio(null); return }
      toastSuccess('Servicio eliminado.'); setDelServicio(null); router.refresh()
    })
  }
  function doEliminarRecurso() {
    if (!delRecurso) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarRecurso(delRecurso.recurso_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelRecurso(null); return }
      toastSuccess(`${et.recurso} eliminado.`); setDelRecurso(null); router.refresh()
    })
  }
  function doImportarRRHH() {
    const ld = toastLoading('Importando…')
    startTransition(async () => {
      const res = await importarPersonalRRHH()
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(res.importados ? `${res.importados} importado${res.importados !== 1 ? 's' : ''} de RRHH.` : 'No hay personal nuevo que importar.')
      router.refresh()
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
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarConfirmacionCitas(v)
      await ld.dismiss()
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
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarBotConfigCitas(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Configuración guardada.'); router.refresh()
    })
  }
  function eliminarBot() {
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarBotConfigCitas()
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Bot eliminado.'); router.refresh()
    })
  }
  function toggleBot(activo: boolean) {
    const ld = toastLoading('Actualizando…')
    startTransition(async () => {
      const res = await toggleActivoBotCitas(activo)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(activo ? 'Bot activado.' : 'Bot desactivado.'); router.refresh()
    })
  }

  function toggleIaBot(activa: boolean) {
    const ld = toastLoading('Actualizando…')
    startTransition(async () => {
      const res = await toggleIaBotCitas(activa)
      await ld.dismiss()
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
          <div className="page-title-ia">
            {/* Estaba a fuego: un gimnasio que llama «Clases» a sus citas veía
                «Citas» en la página y «Clases» en el menú. */}
            <h1 className="page-title">{data.etiquetas.reservas}</h1>
            <IaTouchpoint tipo="citas" descripcion="un análisis de tu agenda" />
          </div>
          <p className="page-subtitle">
            {activeTab === 'agenda' && totalHoy > 0
              ? `Hoy: ${pendientesHoy} pendientes · ${confirmadasHoy} confirmadas · Total ${totalHoy} citas`
              : `Gestiona las citas de tu negocio.`}
          </p>
        </div>
        <div className="tes-header-actions">
          {activeTab === 'agenda' && (
            <ExportarMenu
              clave="citas"
              /* La búsqueda VIAJA: el registro ya sabe buscar por cliente y teléfono, y
                 sin esto se filtraba en pantalla y el fichero salía con todo. */
              filtro={filtroExport(declaracion, {
                desde: data.rango.desde, hasta: data.rango.hasta, q: search,
              })}
              resumen={[...resumenDe(declaracion), ...(search ? [`«${search}»`] : [])]}
            />
          )}
          {activeTab === 'agenda' && puedeEditar && (
            <button className="btn btn-primary" onClick={() => setShowNueva(true)}>
              <Plus size={14} strokeWidth={2.5} /> Nueva cita
            </button>
          )}
          {activeTab === 'recursos' && puedeEditar && data.rrhh_activo && data.empleados.some(e => !e.ya_importado) && (
            <button className="btn btn-secondary" onClick={doImportarRRHH} disabled={isPending}>
              <Download size={14} strokeWidth={2.5} /> Importar de RRHH
            </button>
          )}
          {activeTab === 'recursos' && puedeEditar && (
            <button className="btn btn-primary" onClick={() => { setEditRecurso(null); setShowRecurso(true) }}>
              <Plus size={14} strokeWidth={2.5} /> Nuevo {et.recurso.toLowerCase()}
            </button>
          )}
          {/* Importar es su propio botón, no un desplegable escondido dentro del alta:
              con el catálogo delante se ve qué falta por traer y se marca de una vez. */}
          {activeTab === 'servicios' && puedeEditar && data.catalogo.some(c => !c.ya_importado) && (
            <button className="btn btn-secondary" onClick={() => setShowImportar(true)} disabled={isPending}>
              <Download size={14} strokeWidth={2.5} /> Importar del catálogo
            </button>
          )}
          {activeTab === 'servicios' && puedeEditar && (
            <button className="btn btn-primary" onClick={() => { setEditServicio(null); setShowServicio(true) }}>
              <Plus size={14} strokeWidth={2.5} /> Nuevo {servicioNombre.toLowerCase()}
            </button>
          )}
        </div>
      </div>
      {children}

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
      {/* Antes eran dos `<input type=date>` sin rótulo y con una trampa: al dejar «hasta»
          vacío el filtro caía a `filtroHasta || filtroDesde`, así que pedir «desde el 1 de
          agosto» enseñaba SOLO el 1 de agosto. */}
      <Filtros
        filtros={declaracion}
        rango={data.rango}
        q={search}
        placeholder="Buscar por cliente, teléfono o notas…"
        presets={PRESETS_CITAS}
        hayMas={data.hay_mas}
        onCargando={setCargando}
      />

      {data.hay_mas && (
        <AvisoTope mostrados={data.citas.length} total={data.total}
          limite={data.limite} sustantivo="citas" femenino />
      )}

      {/* Por cerrar: confirmadas de días pasados sin marcar. El aviso lleva al listado
          ya filtrado y el trabajo se hace con la BulkBar de siempre. */}
      {data.por_cerrar > 0 && (
        <div className="alert alert-warning alert-cta">
          <div className="alert-cta-texto">
            <strong className="alert-titulo">
              {data.por_cerrar} cita{plural(data.por_cerrar)} sin cerrar
            </strong>
            Son de días que ya pasaron y siguen confirmadas. Márcalas como atendidas o como
            «no asistió»; a los {DIAS_CIERRE_AUTO} días se cierran solas.
          </div>
          <Link className="btn btn-aviso btn-sm" href={`/portal/citas?estado=CONFIRMADA&desde=&hasta=${ayer}`}>
            Verlas
          </Link>
        </div>
      )}

      <TablaCargando activo={cargando}>
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
                  {puedeEditar && (
                    <th className="col-check">
                      <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                    </th>
                  )}
                  <ThOrden orden={ordCitas} clave="fecha" />
                  <ThOrden orden={ordCitas} clave="hora" />
                  <ThOrden orden={ordCitas} clave="servicio" />
                  <ThOrden orden={ordCitas} clave="recurso" />
                  <ThOrden orden={ordCitas} clave="cliente" />
                  <ThOrden orden={ordCitas} clave="estado" />
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {citaItems.map(c => (
                  <tr key={c.reserva_id} className="table-row-clickable" onClick={() => setDetalleCita(c)}>
                    {puedeEditar && (
                      <td className="col-check" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="row-check"
                          checked={sel.isSelected(c.reserva_id)}
                          onChange={() => sel.toggle(c.reserva_id)}
                          aria-label={`Seleccionar cita de ${c.nombre_cliente}`} />
                      </td>
                    )}
                    <td data-label="Fecha"><strong>{formatFecha(c.fecha)}</strong></td>
                    <td data-label="Hora" className="tes-nowrap">
                      {c.hora ? `${formatHora(c.hora)}${c.hora_fin ? ` – ${formatHora(c.hora_fin)}` : ''}` : '—'}
                    </td>
                    <td data-label={servicioNombre}>{c.servicio_nombre}</td>
                    <td data-label={et.recurso}>{c.recurso_nombre}</td>
                    <td data-label="Cliente">
                      <strong className="cell-clamp">{c.nombre_cliente}</strong>
                      {c.telefono && <div className="text-sm-muted">{c.telefono}</div>}
                    </td>
                    <td data-label="Estado">
                      <div className="badge-row">
                        <span className={`badge ${ESTADO_BADGE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span>
                        {c.forzada && <span className="badge badge-warning" title="Se metió saltándose una regla de la agenda">forzada</span>}
                      </div>
                      <div className="text-xs-muted">{CANAL_LABEL[c.canal] ?? c.canal}</div>
                      {c.cierre_auto && <div className="text-xs-muted">cerrada automáticamente</div>}
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => setDetalleCita(c)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                        {puedeEditar && (c.estado === 'PENDIENTE' || c.estado === 'CONFIRMADA') && (
                          <>
                          {c.estado === 'PENDIENTE' && (
                            <>
                              <button className="row-actions-item"
                                onClick={() => setCambioEstado({ cita: c, a: 'CONFIRMADA' })} disabled={isPending}><Check size={15} strokeWidth={2} /> Confirmar</button>
                              <button className="row-actions-item row-actions-item-danger"
                                onClick={() => setCambioEstado({ cita: c, a: 'RECHAZADA' })} disabled={isPending}><X size={15} strokeWidth={2} /> Rechazar</button>
                            </>
                          )}
                          {/* Mover (CIT-1): antes había que cancelar y volver a crear,
                              y al cliente le llegaba un aviso de cancelación. */}
                          <button className="row-actions-item"
                            onClick={() => setMoverCita(c)} disabled={isPending}><Pencil size={15} strokeWidth={2} /> Mover cita</button>
                          {c.estado === 'CONFIRMADA' && (
                            <>
                              <button className="row-actions-item row-actions-item-success"
                                onClick={() => setCambioEstado({ cita: c, a: 'ATENDIDA' })} disabled={isPending}><Check size={15} strokeWidth={2} /> Atendió</button>
                              <button className="row-actions-item"
                                onClick={() => setCambioEstado({ cita: c, a: 'NO_SHOW' })} disabled={isPending}><UserX size={15} strokeWidth={2} /> No asistió</button>
                              <button className="row-actions-item row-actions-item-danger"
                                onClick={() => setCambioEstado({ cita: c, a: 'CANCELADA' })} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Cancelar cita</button>
                            </>
                          )}
                          </>
                        )}
                        {/* Deshacer, solo con la fecha por delante. */}
                        {puedeEditar && ESTADOS_DESHACIBLES.includes(c.estado) && c.fecha >= hoy && (
                          <button className="row-actions-item"
                            onClick={() => setCambioEstado({ cita: c, a: 'PENDIENTE' })} disabled={isPending}><Undo2 size={15} strokeWidth={2} /> Deshacer</button>
                        )}
                        {/* El aviso al cliente lo da el dueño, con el texto ya
                            redactado y el chat abierto (fase 10). */}
                        <AvisarCliente compacto
                          telefono={c.telefono} chatTelegram={c.telegram_chat_id}
                          datos={{ tipo: 'cita', negocio: data.negocio, nombre: c.nombre_cliente,
                                   fecha: c.fecha, hora: c.hora, estado: c.estado }} />
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
      </TablaCargando>
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
                <tr>
                  <ThOrden orden={ordRecursos} clave="nombre" />
                  <ThOrden orden={ordRecursos} clave="tipo" />
                  <ThOrden orden={ordRecursos} clave="servicios">{servicioPlural}</ThOrden>
                  <ThOrden orden={ordRecursos} clave="horario" />
                  <ThOrden orden={ordRecursos} clave="estado" />
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {ordRecursos.filas.map(r => (
                  <tr key={r.recurso_id}
                    className={puedeEditar ? 'table-row-clickable' : undefined}
                    onClick={puedeEditar ? () => { setEditRecurso(r); setShowRecurso(true) } : undefined}>
                    <td data-label="Nombre"><strong className="cell-clamp">{r.nombre}</strong></td>
                    <td data-label="Tipo" className="text-sm-muted">{r.tipo ?? '—'}</td>
                    <td data-label={servicioPlural} className="text-sm-muted">{r.servicio_ids.length === 0 ? 'Todos' : `${r.servicio_ids.length}`}</td>
                    <td data-label="Horario" className="text-sm-muted">
                      {r.horarios.length === 0 ? <span className="text-xs-muted">Sin horario</span>
                        : r.horarios.map(h => DIA_LABEL[h.dia_semana]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
                    </td>
                    <td data-label="Estado">
                      <div className="badge-row">
                        <span className={`badge ${r.activo ? 'badge-success' : 'badge-neutral'}`}>{r.activo ? 'Activo' : 'Inactivo'}</span>
                        {/* Ausente HOY: es lo que hace falta saber de un vistazo cuando
                            alguien llama preguntando por él. */}
                        {r.ausencias.some(a => a.fecha_desde <= hoy && a.fecha_hasta >= hoy) && (
                          <span className="badge badge-warning">Ausente hoy</span>
                        )}
                      </div>
                    </td>
                    <td className="col-actions">
                      {puedeEditar && (
                        <RowActions>
                          <button className="row-actions-item" onClick={() => { setEditRecurso(r); setShowRecurso(true) }}><Pencil size={15} strokeWidth={2} /> Editar</button>
                          <button className="row-actions-item row-actions-item-danger" onClick={() => setDelRecurso(r)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
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

      {/* ── Tab: Servicios ───────────────────────────────────────────────── */}
      {activeTab === 'servicios' && (
      <div className="card card-table">
        {data.servicios.length === 0 ? (
          <div className="mon-empty">
            <CalendarDays size={36} strokeWidth={1} opacity={0.2} />
            <p>Aún no hay {servicioPlural.toLowerCase()}. Crea los que ofreces (con su duración) para poder agendar. Si solo das un tipo de cita, créalo igualmente como un único servicio (p.ej. «Consulta», 30 min).</p>
            {puedeEditar && data.catalogo.some(c => !c.ya_importado) && (
              <button className="btn btn-secondary btn-sm" onClick={() => setShowImportar(true)}>
                <Download size={14} strokeWidth={2.5} /> Traerlos de mi catálogo
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <ThOrden orden={ordServicios} clave="nombre" />
                  <ThOrden orden={ordServicios} clave="duracion" className="col-num" />
                  <ThOrden orden={ordServicios} clave="precio"   className="col-num" />
                  <ThOrden orden={ordServicios} clave="estado" />
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {ordServicios.filas.map(s => (
                  <tr key={s.servicio_id}
                    className={puedeEditar ? 'table-row-clickable' : undefined}
                    onClick={puedeEditar ? () => { setEditServicio(s); setShowServicio(true) } : undefined}>
                    <td data-label="Nombre"><strong className="cell-clamp">{s.nombre}</strong></td>
                    <td data-label="Duración" className="col-num tes-monto-cell">
                      {s.duracion_minutos} min
                      {s.margen_minutos > 0 && <div className="text-xs-muted">+{s.margen_minutos} de margen</div>}
                    </td>
                    <td data-label="Precio" className="col-num tes-monto-cell cita-precio">{formatPrecio(s.precio, s.moneda)}</td>
                    <td data-label="Estado"><span className={`badge ${s.activo ? 'badge-success' : 'badge-neutral'}`}>{s.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="col-actions">
                      {puedeEditar && (
                        <RowActions>
                          <button className="row-actions-item" onClick={() => { setEditServicio(s); setShowServicio(true) }}><Pencil size={15} strokeWidth={2} /> Editar</button>
                          <button className="row-actions-item row-actions-item-danger" onClick={() => setDelServicio(s)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
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
        <IaBotBanner entidad="citas" activa={data.bot_config.ia_activa}
          isPending={isPending} onToggle={toggleIaBot} />
      )}

      {/* U20: este bloque colgaba suelto encima de las tarjetas, sin tarjeta propia,
          en las dos vistas — parecía un ajuste de la pantalla y no de la funcionalidad. */}
      <div className="card res-section">
        <div className="card-header"><h2 className="card-title">Confirmación automática</h2></div>
        {data.tieneAmbas && (
          <span className="text-xs-muted res-ambito">
            Solo para citas. Tus reservas tienen la suya.
          </span>
        )}
      <div className="res-conf-item">
        <div className="res-conf-item-text">
          <span className="res-conf-item-title">Confirmar sin revisar</span>
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
      </div>

      {/* Enlace público */}
      <div className="card res-section">
        <div className="card-header"><h2 className="card-title">Enlace de citas</h2></div>
        {/* Ámbito (11.1): ver la nota equivalente en Reservas. */}
        {data.tieneAmbas && (
          <span className="text-xs-muted res-ambito">
            La ruta <code>/citas</code> es solo de Citas, pero <strong>la dirección es del
            negocio</strong>: si la cambias aquí, cambia también en Reservas y en tu catálogo.
          </span>
        )}
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
                      {puedeEditar && (
                        <button className="row-actions-item" onClick={() => setEditandoSlug(true)} disabled={isPending}><Pencil size={15} strokeWidth={2} /> Editar enlace</button>
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
                  <input className="input" name="slug" placeholder="tu-negocio" value={slugForm} onChange={e => setSlugForm(e.target.value)} />
                  <span className="res-slug-suffix">/citas</span>
                </div>
              </div>
            </div>
            <div className="res-form-submit res-actions-row">
              {data.slug && <button type="button" className="btn btn-secondary" onClick={() => { setEditandoSlug(false); setSlugForm(data.slug ?? '') }}>Cancelar</button>}
              <button type="submit" className="btn btn-primary" disabled={isPending}>
                {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : data.slug ? 'Modificar enlace' : 'Guardar enlace'}
              </button>
            </div>
          </form>
        ) : null}
      </div>

      {/* QR del enlace, igual que en el catálogo y en Reservas. */}
      {data.slug && (
        <QrEnlace url={`https://${host}/${data.slug}/citas`} nombreArchivo={`qr-citas-${data.slug}`}
          titulo="Código QR de citas" />
      )}

      {/* Bot de Telegram (independiente del de Reservas) */}
      <div className="card res-section">
        <div className="card-header"><h2 className="card-title">Bot de Telegram · Citas</h2></div>
        {data.tieneAmbas && (
          <span className="text-xs-muted res-ambito">
            Solo para Citas. Tus Reservas tienen su propio bot, con otro token y otro
            código de vínculo, en <strong>Reservas › Configuración</strong>.
          </span>
        )}

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
                      {/* `webhook_registrado` era el estado del día del alta. Lo que
                          vale es lo que diga Telegram ahora: botón «Comprobar». */}
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
                  Abre tu bot de <strong>Citas</strong> en Telegram y envía <code>/start {data.bot_config.codigo_vinculo ?? '—'}</code>.
                  Es un código distinto del de Reservas. Recibirás ahí cada cita nueva, con botones para confirmarla o rechazarla.
                </span>
              </div>
            ) : (
              <div className="info-box">
                <span className="text-xs-muted">
                  ✓ Chat del dueño vinculado · recibes los avisos de citas nuevas. Si cambias de móvil
                  o de cuenta de Telegram, vuelve a enviar <code>/start {data.bot_config.codigo_vinculo ?? '—'}</code>.
                </span>
              </div>
            )}

            <BotDiagnostico columna="bot_config_citas" />
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
      <ReglasReservaSection reglas={data.reglas} iaActiva={data.tieneIa && data.bot_config.ia_activa} compartidas={data.tieneAmbas} />

      {/* Cierres y festivos */}
      <CierresSection cierres={data.cierres} iaActiva={data.tieneIa && data.bot_config.ia_activa} compartidas={data.tieneAmbas} />

      </>
      )}

      {/* Modales */}
      {showNueva && <NuevaCitaModal data={data} onClose={() => setShowNueva(false)} onSaved={() => { setShowNueva(false); router.refresh() }} />}
      {moverCita && (
        <NuevaCitaModal data={data} cita={moverCita}
          onClose={() => setMoverCita(null)}
          onSaved={() => { setMoverCita(null); router.refresh() }} />
      )}
      {detalleCita && (
        <CitaDetalleModal cita={detalleCita} puedeEditar={puedeEditar} onClose={() => setDetalleCita(null)}
          onCambiarEstado={a => { const c = detalleCita; setDetalleCita(null); setCambioEstado({ cita: c, a }) }}
          onMover={() => { const c = detalleCita; setDetalleCita(null); setMoverCita(c) }} />
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

      {activeTab === 'agenda' && puedeEditar && (
        <BulkBar count={sel.count} onClear={sel.clear}>
          <button className="btn btn-secondary btn-sm" disabled={isPending}
            onClick={() => setLoteAccion({ estado: 'CONFIRMADA', label: 'Confirmar' })}>
            <Check size={14} strokeWidth={2} /> Confirmar
          </button>
          {/* Cerrar la jornada en bloque (U5): al acabar el día se marca de una vez
              quién vino y quién no, en vez de abrir el detalle de cada cita. */}
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
          title={`¿${loteAccion.label} ${sel.count} cita${plural(sel.count)}?`}
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
