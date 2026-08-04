'use client'

import { toastError, toastLoading, toastWarning } from '@/app/contexts/ToastContext'
import { useState, useTransition } from 'react'
import Link                        from 'next/link'
import { useRouter }               from 'next/navigation'
import {
  reactivarEmpleado,
  eliminarEmpleado,
  copiarEmpleadoAEmpresa,
  guardarContrato,
  actualizarContrato,
  eliminarContrato,
  guardarConceptoEmpleado,
  eliminarConceptoEmpleado,
  alternarConceptoEmpleado,
  guardarIncidencia,
  eliminarIncidencia,
  obtenerReciboNomina,
  type IncidenciaMes,
  type EmpleadoDetalleData,
  type Contrato,
  type ConceptoEmpleado,
  type TipoContrato,
  type Periodicidad,
  type NominaConLineas,
} from '@/app/actions/portal/rrhh'
import { EmpleadoModal, BajaModal, ConfirmEliminar } from '../PersonalView'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { RowActions } from '@/components/portal/RowActions'
import CopiarAEmpresaModal from '@/components/portal/CopiarAEmpresaModal'
import { Copy, Download, FileText, Pencil, Plus, RefreshCw, RotateCcw, Trash2, UserMinus, Wallet, X } from 'lucide-react'
import { usePagination, TablePagination } from '@/components/TablePagination'
import {
  actualizarConceptosNominas,
  formatMonto,
  hoyISO as hoyISOShared,
  formatPeriodo,
} from '../../_shared/NominaDetalleModal'

type IncidenciaConId = IncidenciaMes & { incidencia_id: string; periodo: string }

// ── Constantes / helpers ────────────────────────────────────────────────────────

const TIPO_CONTRATO_LABEL: Record<TipoContrato, string> = {
  INDEFINIDO: 'Indefinido', TEMPORAL: 'Temporal', POR_OBRA: 'Por obra', PRACTICAS: 'Prácticas',
}
const PERIODICIDAD_LABEL: Record<Periodicidad, string> = {
  MENSUAL: 'Mensual', QUINCENAL: 'Quincenal', SEMANAL: 'Semanal', POR_HORA: 'Por hora',
}
const TIPOS_CONTRATO: TipoContrato[]  = ['INDEFINIDO', 'TEMPORAL', 'POR_OBRA', 'PRACTICAS']
const PERIODICIDADES:  Periodicidad[] = ['MENSUAL', 'QUINCENAL', 'SEMANAL', 'POR_HORA']

function hoyISO(): string { return hoyISOShared() }
function formatFecha(f: string | null): string {
  if (!f) return '—'
  const [y, m, d] = f.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Modal: contrato (crear / editar · documento + PDF opcional) ──────────────────

function ContratoModal({
  empleadoId, contrato, onClose, onSaved,
}: {
  empleadoId: string
  contrato?:  Contrato | null   // presente = edición
  onClose:    () => void
  onSaved:    () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [nuevoNombre, setNuevoNombre] = useState<string | null>(null)  // nombre del PDF recién elegido
  const esEdicion = !!contrato

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      let res
      if (esEdicion) {
        fd.set('contrato_id', contrato!.contrato_id)
        res = await actualizarContrato(fd)
      } else {
        fd.set('empleado_id', empleadoId)
        res = await guardarContrato(fd)
      }
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{esEdicion ? 'Editar contrato' : 'Nuevo contrato'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="text-sm-muted mb-3">
              Registra el contrato del empleado y, si quieres, adjunta su PDF. Es un documento de archivo:
              no cambia el salario ni la nómina.
            </p>
            <div className="ter-form-grid">
              <div className="input-group ter-col-span-3">
                <label>Tipo de contrato</label>
                <select className="input" name="tipo_contrato" defaultValue={contrato?.tipo_contrato ?? 'INDEFINIDO'}>
                  {TIPOS_CONTRATO.map(t => <option key={t} value={t}>{TIPO_CONTRATO_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="input-group ter-col-span-3">
                <label>Periodicidad</label>
                <select className="input" name="periodicidad" defaultValue={contrato?.periodicidad ?? 'MENSUAL'}>
                  {PERIODICIDADES.map(p => <option key={p} value={p}>{PERIODICIDAD_LABEL[p]}</option>)}
                </select>
              </div>
              <div className="input-group ter-col-span-2">
                <label>Inicio <span className="required">*</span></label>
                <input className="input" name="fecha_inicio" type="date" required
                  defaultValue={contrato?.fecha_inicio?.split('T')[0] ?? hoyISO()} />
              </div>
              <div className="input-group ter-col-span-2">
                <label>Fin <span className="input-hint-inline">(opcional)</span></label>
                <input className="input" name="fecha_fin" type="date" defaultValue={contrato?.fecha_fin?.split('T')[0] ?? ''} />
              </div>

              <div className="input-group ter-col-full">
                <label>Documento PDF <span className="input-hint-inline">(opcional · máx. 10 MB)</span></label>
                {esEdicion && contrato?.pdf_url && !nuevoNombre && (
                  <div className="con-pdf-actual">
                    <a href={contrato.pdf_url} target="_blank" rel="noopener noreferrer" className="link-primary det-meta-inline">
                      <FileText size={14} strokeWidth={2} /> {contrato.pdf_nombre ?? 'Ver PDF actual'}
                    </a>
                    <span className="text-xs-muted">Elige un archivo para reemplazarlo.</span>
                  </div>
                )}
                <input className="input" name="pdf" type="file" accept="application/pdf"
                  onChange={e => setNuevoNombre(e.target.files?.[0]?.name ?? null)} />
                <span className="input-hint">
                  {nuevoNombre
                    ? `Se subirá: ${nuevoNombre}`
                    : esEdicion && contrato?.pdf_url
                      ? 'Deja este campo vacío para conservar el PDF actual.'
                      : 'Adjunta el PDF del contrato firmado (opcional).'}
                </span>
              </div>

              <div className="input-group ter-col-full">
                <label>Notas <span className="input-hint-inline">(opcional)</span></label>
                <input className="input" name="notas" defaultValue={contrato?.notas ?? ''} placeholder="Referencia, anexos…" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : (esEdicion ? 'Guardar cambios' : 'Guardar contrato')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Campo de detalle ─────────────────────────────────────────────────────────────

function Campo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="det-label">{label}</div>
      <div className="det-value">{value || <span className="text-faint">—</span>}</div>
    </div>
  )
}

// ── Incidencias del mes ─────────────────────────────────────────────────────────
// Lo variable de un período: días trabajados, nocturnidad, feriados, una
// penalización. Se carga ANTES de generar la nómina, que es cuando el dueño tiene
// los datos del mes delante. Antes no había dónde: la única vía era editar la línea
// de una nómina ya generada, que perdía el motivo y lo borraba el recálculo.

function mesActualISO(): string { return new Date().toISOString().slice(0, 7) }

function IncidenciaModal({
  empleadoId, moneda, incidencia, esCuba, onClose, onDone,
}: {
  empleadoId:  string
  moneda:      string
  incidencia:  IncidenciaConId | null
  /** Los DÍAS solo se piden en el modelo cubano: el general no prorratea. */
  esCuba:      boolean
  onClose:     () => void
  onDone:      () => void
}) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('empleado_id', empleadoId)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarIncidencia(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      // El aviso no bloquea: la incidencia ya se guardó, solo conviene revisarla.
      if (res.aviso) toastWarning(res.aviso)
      onDone()
    })
  }

  return (
    <div className="modal-backdrop open dialog-top">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{incidencia ? 'Editar incidencias' : 'Incidencias del mes'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="info-box">
            <strong className="info-box-title">Lo que cambia este mes</strong>
            <span className="text-xs-muted">
              Se aplica al generar la nómina de ese mes. Lo que dejes vacío no se toca:
              sin días trabajados se paga el <strong>mes completo</strong>, que es lo normal.
            </span>
          </div>
          <form id="incidencia-form" onSubmit={handleSubmit}>
            <div className="ter-form-grid">
              <div className="input-group ter-col-span-3">
                <label htmlFor="inc-periodo">Mes <span className="required">*</span></label>
                <input className="input" id="inc-periodo" name="periodo" type="month" required
                  defaultValue={incidencia?.periodo ?? mesActualISO()}
                  readOnly={!!incidencia} />
                {incidencia && <span className="input-hint">El mes no se cambia: crea otra incidencia.</span>}
              </div>

              {esCuba && (
                <>
                  <div className="input-group ter-col-span-3">
                    <label htmlFor="inc-dias">Días trabajados</label>
                    <input className="input" id="inc-dias" name="dias_trabajados" type="number"
                      min="0" max="31" step="any" defaultValue={incidencia?.dias_trabajados ?? ''} />
                    <span className="input-hint">Vacío = mes completo.</span>
                  </div>
                  <div className="input-group ter-col-span-3">
                    <label htmlFor="inc-vac">Días de vacaciones que se pagan</label>
                    <input className="input" id="inc-vac" name="dias_vacaciones" type="number"
                      min="0" max="31" step="any" defaultValue={incidencia?.dias_vacaciones ?? 0} />
                  </div>
                </>
              )}

              <div className="input-group ter-col-span-3">
                <label htmlFor="inc-extra">Pago extra ({moneda})</label>
                <input className="input" id="inc-extra" name="pago_extra" type="number" min="0" step="any"
                  defaultValue={incidencia?.pago_extra ?? 0} />
              </div>
              <div className="input-group ter-col-span-3">
                <label htmlFor="inc-noct">Nocturnidad ({moneda})</label>
                <input className="input" id="inc-noct" name="pago_nocturnidad" type="number" min="0" step="any"
                  defaultValue={incidencia?.pago_nocturnidad ?? 0} />
              </div>
              <div className="input-group ter-col-span-3">
                <label htmlFor="inc-fer">Feriados ({moneda})</label>
                <input className="input" id="inc-fer" name="feriados" type="number" min="0" step="any"
                  defaultValue={incidencia?.feriados ?? 0} />
              </div>
              <div className="input-group ter-col-span-3">
                <label htmlFor="inc-pen">Penalización ({moneda})</label>
                <input className="input" id="inc-pen" name="penalizacion" type="number" min="0" step="any"
                  defaultValue={incidencia?.penalizacion ?? 0} />
              </div>
              <div className="input-group ter-col-span-3">
                <label htmlFor="inc-otros">Otros descuentos ({moneda})</label>
                <input className="input" id="inc-otros" name="otros_descuentos" type="number" min="0" step="any"
                  defaultValue={incidencia?.otros_descuentos ?? 0} />
              </div>

              {esCuba && (
                <div className="input-group ter-col-full">
                  <label htmlFor="inc-subs">Subsidios adelantados ({moneda})</label>
                  <input className="input" id="inc-subs" name="pago_subsidios" type="number" min="0" step="any"
                    defaultValue={incidencia?.pago_subsidios ?? 0} />
                  <span className="input-hint">
                    Se le suma al neto porque lo cobra, pero <strong>no cuenta como coste</strong>:
                    al confirmar la nómina queda como pendiente de cobro a la Seguridad Social,
                    y lo liquidas en Tesorería cuando llegue el reembolso.
                  </span>
                </div>
              )}
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" form="incidencia-form" className="btn btn-primary" disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function IncidenciasSection({
  empleadoId, moneda, incidencias, esCuba, vacaciones, onChanged,
}: {
  empleadoId:  string
  moneda:      string
  incidencias: IncidenciaConId[]
  esCuba:      boolean
  vacaciones:  { importe: number; moneda: string; apertura: number }
  onChanged:   () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [editando, setEditando] = useState<IncidenciaConId | 'nueva' | null>(null)
  const [borrando, setBorrando] = useState<IncidenciaConId | null>(null)

  function borrar() {
    if (!borrando) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarIncidencia(borrando.incidencia_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setBorrando(null); return }
      setBorrando(null); onChanged()
    })
  }

  const resumen = (i: IncidenciaConId): string => {
    const p: string[] = []
    if (esCuba && i.dias_trabajados !== null) p.push(`${i.dias_trabajados} días`)
    if (esCuba && i.dias_vacaciones > 0)      p.push(`${i.dias_vacaciones} d. vacaciones`)
    if (i.pago_extra > 0)       p.push(`+${formatMonto(i.pago_extra)} extra`)
    if (i.pago_nocturnidad > 0) p.push(`+${formatMonto(i.pago_nocturnidad)} nocturnidad`)
    if (i.feriados > 0)         p.push(`+${formatMonto(i.feriados)} feriados`)
    if (i.penalizacion > 0)     p.push(`−${formatMonto(i.penalizacion)} penalización`)
    if (i.otros_descuentos > 0) p.push(`−${formatMonto(i.otros_descuentos)} otros`)
    return p.length ? p.join(' · ') : 'Mes completo, sin novedades'
  }

  return (
    <div className="det-card">
      <div className="card-header">
        <h2 className="card-title">Incidencias del mes</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando('nueva')}>
          <Plus size={14} strokeWidth={2.5} /> Añadir
        </button>
      </div>
      <p className="text-sm-muted mb-3">
        Lo que cambia en un mes concreto. Se aplica al generar la nómina de ese mes; sin
        incidencia se paga el mes completo.
      </p>

      {/* El saldo se DERIVA de las nóminas confirmadas, no se guarda: así se
          autocorrige si una nómina se reabre o se borra. */}
      {esCuba && (
        <div className="info-box mb-3">
          <strong className="info-box-title">
            Vacaciones acumuladas: {formatMonto(vacaciones.importe)} {vacaciones.moneda}
          </strong>
          <span className="text-xs-muted">
            Lo acumulado en las nóminas ya confirmadas, menos lo que se le haya pagado.
            {vacaciones.apertura > 0.005 && (
              <> Incluye <strong>{formatMonto(vacaciones.apertura)} {vacaciones.moneda}</strong> que
              ya traía acumulados al empezar a usar CLAUX.</>
            )}
          </span>
        </div>
      )}

      {incidencias.length === 0 ? (
        <p className="text-sm-muted">Sin incidencias cargadas.</p>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr><th>Mes</th><th>Qué pasó</th><th className="col-actions"></th></tr>
            </thead>
            <tbody>
              {incidencias.map(i => (
                <tr key={i.incidencia_id}>
                  <td data-label="Mes"><strong>{formatPeriodo(i.periodo)}</strong></td>
                  <td data-label="Qué pasó" className="cell-truncate">{resumen(i)}</td>
                  <td className="col-actions">
                    <RowActions>
                      <button className="row-actions-item" onClick={() => setEditando(i)}>
                        <Pencil size={14} strokeWidth={2} /> Editar
                      </button>
                      <button className="row-actions-item row-actions-item-danger" onClick={() => setBorrando(i)}>
                        <Trash2 size={14} strokeWidth={2} /> Eliminar
                      </button>
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <IncidenciaModal
          empleadoId={empleadoId}
          moneda={moneda}
          esCuba={esCuba}
          incidencia={editando === 'nueva' ? null : editando}
          onClose={() => setEditando(null)}
          onDone={() => { setEditando(null); onChanged() }}
        />
      )}
      {borrando && (
        <ConfirmDialog
          danger
          title="Eliminar incidencias"
          body={`Se eliminan las incidencias de ${formatPeriodo(borrando.periodo)}. Las nóminas ya generadas de ese mes no cambian: guardan su propia copia.`}
          confirmLabel="Eliminar"
          onConfirm={borrar}
          onCancel={() => setBorrando(null)}
        />
      )}
      {isPending && null}
    </div>
  )
}

// ── Conceptos del trabajador ────────────────────────────────────────────────────

function ConceptoModal({
  empleadoId, moneda, concepto, onClose, onDone,
}: {
  empleadoId: string
  moneda:     string
  /** null = alta. Editar de verdad llegó con la mig. 141: antes había que borrar y recrear. */
  concepto:   ConceptoEmpleado | null
  onClose:    () => void
  onDone:     () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [modo, setModo]               = useState<'FIJO' | 'PORCENTAJE'>(concepto?.modo ?? 'FIJO')
  const [recurrencia, setRecurrencia] = useState<'RECURRENTE' | 'PUNTUAL'>(concepto?.recurrencia ?? 'RECURRENTE')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('empleado_id', empleadoId)
    if (concepto) fd.set('concepto_id', concepto.concepto_id)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarConceptoEmpleado(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onDone()
    })
  }

  return (
    <div className="modal-backdrop open dialog-top">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{concepto ? 'Editar concepto' : 'Nuevo concepto'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <form id="concepto-form" onSubmit={handleSubmit}>
            <div className="ter-form-grid">
              <div className="input-group ter-col-full">
                <label htmlFor="cpt-nombre">Concepto <span className="required">*</span></label>
                <input className="input" id="cpt-nombre" name="nombre" required maxLength={80}
                  defaultValue={concepto?.nombre ?? ''} placeholder="Transporte, préstamo…" />
              </div>

              <div className="input-group ter-col-span-3">
                <label htmlFor="cpt-tipo">Tipo <span className="required">*</span></label>
                <select className="input" id="cpt-tipo" name="tipo" defaultValue={concepto?.tipo ?? 'RETENCION'}>
                  <option value="RETENCION">Se le descuenta</option>
                  <option value="DEVENGO">Se le suma</option>
                </select>
              </div>

              <div className="input-group ter-col-span-3">
                <label htmlFor="cpt-modo">Cómo se calcula <span className="required">*</span></label>
                <select className="input" id="cpt-modo" name="modo" value={modo}
                  onChange={e => setModo(e.target.value as 'FIJO' | 'PORCENTAJE')}>
                  <option value="FIJO">Importe fijo</option>
                  <option value="PORCENTAJE">Porcentaje</option>
                </select>
              </div>

              <div className="input-group ter-col-span-3">
                <label htmlFor="cpt-valor">
                  {modo === 'PORCENTAJE' ? 'Porcentaje (%)' : `Importe (${moneda})`} <span className="required">*</span>
                </label>
                <input className="input" id="cpt-valor" name="valor" type="number" required
                  min="0.01" step="any" max={modo === 'PORCENTAJE' ? 100 : undefined}
                  defaultValue={concepto?.valor ?? ''} />
              </div>

              {/* La base solo se pregunta si es un porcentaje QUE RESTA: un devengo
                  porcentual solo puede salir del salario del período, porque un bono
                  que fuera un % del devengado se estaría incluyendo a sí mismo. */}
              {modo === 'PORCENTAJE' && (
                <div className="input-group ter-col-span-3">
                  <label htmlFor="cpt-base">Porcentaje de</label>
                  <select className="input" id="cpt-base" name="base" defaultValue={concepto?.base ?? 'SALARIO_BASE'}>
                    <option value="SALARIO_BASE">El salario del período</option>
                    <option value="DEVENGADO">El devengado (salario + lo que se le suma)</option>
                  </select>
                </div>
              )}

              <div className="input-group ter-col-span-3">
                <label htmlFor="cpt-recurrencia">Cuándo se aplica <span className="required">*</span></label>
                <select className="input" id="cpt-recurrencia" name="recurrencia" value={recurrencia}
                  onChange={e => setRecurrencia(e.target.value as 'RECURRENTE' | 'PUNTUAL')}>
                  <option value="RECURRENTE">Todos los meses</option>
                  <option value="PUNTUAL">Solo un mes</option>
                </select>
              </div>

              {recurrencia === 'PUNTUAL' && (
                <div className="input-group ter-col-span-3">
                  <label htmlFor="cpt-periodo">Mes <span className="required">*</span></label>
                  <input className="input" id="cpt-periodo" name="periodo_aplicable" type="month" required
                    defaultValue={concepto?.periodo_aplicable ?? ''} />
                  <span className="input-hint">Se desactiva solo al confirmar la nómina de ese mes.</span>
                </div>
              )}
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" form="concepto-form" className="btn btn-primary" disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConceptosSection({
  empleadoId, moneda, conceptos, desfasadas, onChanged,
}: {
  empleadoId:   string
  moneda:       string
  conceptos:    ConceptoEmpleado[]
  /** Nóminas en BORRADOR cuya línea suya no cuadra con estos conceptos. */
  desfasadas:   NominaConLineas[]
  onChanged:    () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [delId, setDelId]   = useState<ConceptoEmpleado | null>(null)
  const [editando, setEditando] = useState<ConceptoEmpleado | 'nuevo' | null>(null)

  // Una excepción a una regla del negocio no se edita como un concepto suelto: su
  // nombre y su tipo los manda la regla, y aquí solo se ve qué tiene de particular.
  const propios     = conceptos.filter(c => !c.regla_id)
  const excepciones = conceptos.filter(c => !!c.regla_id)

  function handleDel(c: ConceptoEmpleado) {
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarConceptoEmpleado(c.concepto_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelId(null); return }
      setDelId(null); onChanged()
    })
  }

  function handleToggle(c: ConceptoEmpleado) {
    const ld = toastLoading(c.activo ? 'Desactivando…' : 'Activando…')
    startTransition(async () => {
      const res = await alternarConceptoEmpleado(c.concepto_id, !c.activo)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  function valorDe(c: ConceptoEmpleado): string {
    return c.modo === 'PORCENTAJE'
      ? `${c.valor}% ${c.base === 'DEVENGADO' ? 'del devengado' : 'del salario'}`
      : `${c.valor.toLocaleString('es-ES', { minimumFractionDigits: 2 })} ${moneda}`
  }

  return (
    <div className="det-card">
      <div className="card-header">
        <h2 className="card-title">Conceptos del trabajador</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando('nuevo')}>
          <Plus size={14} strokeWidth={2.5} /> Añadir
        </button>
      </div>
      <p className="text-sm-muted mb-3">
        Lo que este trabajador tiene <strong>de particular</strong>. Lo que es igual para toda la
        plantilla se pone una sola vez como regla, en Nómina.
      </p>

      {propios.length > 0 && (
        <div className="table-wrapper mt-3">
          <table className="table">
            <thead>
              <tr><th>Concepto</th><th>Tipo</th><th className="col-num">Valor</th><th className="col-actions"></th></tr>
            </thead>
            <tbody>
              {propios.map(c => (
                <tr key={c.concepto_id}>
                  <td data-label="Concepto">
                    <strong>{c.nombre}</strong>{' '}
                    {!c.activo && <span className="badge badge-neutral">Desactivado</span>}
                    {c.recurrencia === 'PUNTUAL' && (
                      <div className="text-sm-muted">Solo {formatPeriodo(c.periodo_aplicable ?? '')}</div>
                    )}
                  </td>
                  <td data-label="Tipo">
                    <span className={`badge ${c.tipo === 'DEVENGO' ? 'badge-success' : 'badge-warning'}`}>
                      {c.tipo === 'DEVENGO' ? 'Se le suma' : 'Se le descuenta'}
                    </span>
                  </td>
                  <td data-label="Valor" className="col-num tes-monto-cell">{valorDe(c)}</td>
                  <td className="col-actions">
                    <RowActions>
                      <button className="row-actions-item" onClick={() => setEditando(c)}>
                        <Pencil size={14} strokeWidth={2} /> Editar
                      </button>
                      <button className="row-actions-item" onClick={() => handleToggle(c)}>
                        <RefreshCw size={14} strokeWidth={2} /> {c.activo ? 'Desactivar' : 'Activar'}
                      </button>
                      <button className="row-actions-item row-actions-item-danger" onClick={() => setDelId(c)}>
                        <Trash2 size={14} strokeWidth={2} /> Eliminar
                      </button>
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Las excepciones a una regla se ven aparte: no son «suyas», son su versión
          de algo del negocio, y mezclarlas haría creer que se editan igual. */}
      {excepciones.length > 0 && (
        <>
          <p className="text-sm-muted mt-3 mb-2"><strong>Excepciones a las reglas del negocio</strong></p>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Regla</th><th>Qué se le aplica</th><th className="col-actions"></th></tr>
              </thead>
              <tbody>
                {excepciones.map(c => (
                  <tr key={c.concepto_id}>
                    <td data-label="Regla"><strong>{c.nombre}</strong></td>
                    <td data-label="Qué se le aplica">
                      {c.excluida
                        ? <span className="badge badge-neutral">No se le aplica</span>
                        : valorDe(c)}
                    </td>
                    <td className="col-actions">
                      <button className="ter-action-btn ter-action-danger" title="Quitar la excepción"
                        aria-label={`Quitar la excepción de ${c.nombre}`}
                        onClick={() => setDelId(c)} disabled={isPending}>
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {conceptos.length === 0 && (
        <p className="text-sm-muted">Sin conceptos propios: cobra su salario y lo que digan las reglas del negocio.</p>
      )}

      {editando && (
        <ConceptoModal
          empleadoId={empleadoId}
          moneda={moneda}
          concepto={editando === 'nuevo' ? null : editando}
          onClose={() => setEditando(null)}
          onDone={() => { setEditando(null); onChanged() }}
        />
      )}

      {delId && (
        <ConfirmDialog
          danger
          title={delId.regla_id ? 'Quitar la excepción' : 'Eliminar concepto'}
          body={delId.regla_id
            ? `A partir de la próxima nómina, a este trabajador se le aplicará «${delId.nombre}» como al resto de la plantilla.`
            : `Se elimina «${delId.nombre}». Las nóminas ya generadas no cambian: cada una guarda su propia copia.`}
          confirmLabel={delId.regla_id ? 'Quitar' : 'Eliminar'}
          onConfirm={() => handleDel(delId)}
          onCancel={() => setDelId(null)}
        />
      )}

      {/* Los conceptos se aplican al GENERAR la nómina, así que un borrador ya
          creado se queda como estaba. El aviso sale SOLO si esa línea no cuadra
          con estos conceptos; si cuadra, no hay nada que decir. */}
      {desfasadas.length > 0 && (
        <div className="alert alert-warning alert-cta mt-3">
          <span className="alert-cta-texto">
            {/* Los meses, dichos: sin ellos «4 nóminas» no dice cuáles se van a
                tocar, y el botón las actualiza todas de una vez. */}
            Estos conceptos no están aplicados en {desfasadas.length === 1
              ? `su nómina en borrador de ${formatPeriodo(desfasadas[0].periodo)}`
              : `sus ${desfasadas.length} nóminas en borrador (${desfasadas.map(n => formatPeriodo(n.periodo)).join(', ')})`}.
          </span>
          <button type="button" className="btn btn-aviso btn-sm" disabled={isPending}
            onClick={() => actualizarConceptosNominas(desfasadas, empleadoId, startTransition, onChanged)}>
            <RefreshCw size={14} strokeWidth={2} />
            {desfasadas.length === 1
              ? ` Actualizar ${formatPeriodo(desfasadas[0].periodo)}`
              : ` Actualizar las ${desfasadas.length}`}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Vista de detalle del empleado ────────────────────────────────────────────────

export default function EmpleadoDetalleView({ detalle }: { detalle: EmpleadoDetalleData }) {
  const router = useRouter()
  const { data, empleado, contratos, conceptos, incidencias, vacaciones } = detalle
  const [isPending, startTransition] = useTransition()

  // Los días y las vacaciones solo se piden si SU empresa usa el modelo cubano: en
  // el general no prorratean nada y preguntarlos sería pedir un dato que no se usa.
  const esCuba = data.config_nomina
    .find(c => c.empresa_id === empleado.empresa_id)?.modelo === 'MIPYME_CUBA'

  const [showEdit,      setShowEdit]      = useState(false)
  const [copiar,        setCopiar]        = useState(false)
  const [showBaja,      setShowBaja]      = useState(false)
  const [showDelete,    setShowDelete]    = useState(false)
  const [showNuevo,     setShowNuevo]     = useState(false)
  const [editContrato,  setEditContrato]  = useState<Contrato | null>(null)
  const [delContrato,   setDelContrato]   = useState<Contrato | null>(null)
  /** Nómina cuyo recibo se está generando, para no lanzar dos veces el mismo. */
  const [reciboDe,      setReciboDe]      = useState<string | null>(null)

  const nombre   = [empleado.nombre, empleado.apellidos].filter(Boolean).join(' ')
  const empresa  = data.empresa_nombres[empleado.empresa_id] ?? '—'
  const esActivo = empleado.estado === 'ACTIVO'

  // Nómina de este trabajador: su línea en cada nómina donde aparece
  const miNomina = data.nominas.flatMap(n => {
    const l = n.lineas.find(x => x.empleado_id === empleado.empleado_id)
    return l ? [{ nomina: n, linea: l }] : []
  })
  const { pageItems: nominaItems, ...nominaPag } = usePagination(miNomina)

  // Solo las que de verdad NO cuadran con sus conceptos: el desfase de SU línea lo
  // marca el servidor (`NominaLinea.desfasada`), no una copia de la fórmula aquí.
  // Incluye las CONFIRMADAS sin pagos: se actualizan reabriéndolas, que es el caso
  // real. Con pagos hechos no se ofrece — habría que anularlos en Tesorería.
  const desfasadas = miNomina
    .filter(m => m.linea.desfasada
      && (m.nomina.estado === 'BORRADOR' || m.nomina.pagado <= 0.005))
    .map(m => m.nomina)

  function refrescar() { router.refresh() }

  function reactivar() {
    const ld = toastLoading('Reactivando…')
    startTransition(async () => {
      const res = await reactivarEmpleado(empleado.empleado_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      router.refresh()
    })
  }

  // Recibo de nómina: el servidor da los datos y el PDF se dibuja y se descarga aquí,
  // sin abrir otra página ni recargar (igual que la factura y la oferta). VA FUERA de
  // `startTransition` a propósito: dentro, el toast de carga no llega a pintarse, y en
  // 3G este paso puede tardar lo suficiente para que el usuario crea que no hizo nada.
  async function descargarRecibo(nomina: NominaConLineas) {
    if (reciboDe) return
    setReciboDe(nomina.nomina_id)
    const ld = toastLoading('Generando recibo…')
    try {
      const res = await obtenerReciboNomina(nomina.nomina_id, empleado.empleado_id)
      if (!res.ok) { toastError(res.error); return }
      const { descargarReciboNomina } = await import('@/lib/pdf/recibo-nomina')
      const apellido = (empleado.apellidos ?? '').split(' ')[0] ?? ''
      const quien = [empleado.nombre, apellido].filter(Boolean).join('-').toLowerCase()
      await descargarReciboNomina(res.recibo, `recibo-${quien}-${nomina.periodo}.pdf`)
    } catch {
      toastError('No se pudo generar el recibo.')
    } finally {
      await ld.dismiss()
      setReciboDe(null)
    }
  }

  function confirmarEliminar() {
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarEmpleado(empleado.empleado_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setShowDelete(false); return }
      router.push('/portal/rrhh')
    })
  }

  function confirmarDelContrato() {
    if (!delContrato) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarContrato(delContrato.contrato_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelContrato(null); return }
      setDelContrato(null); router.refresh()
    })
  }

  return (
    <div className="view-container">

      <div className="breadcrumb">
        <Link href="/portal/rrhh">Personal</Link>
        <span>›</span>
        <span className="breadcrumb-current">{nombre}</span>
      </div>

      <div className="det-page-header">
        <div>
          <div className="det-title-group">
            <h1 className="det-page-title">{nombre}</h1>
            <span className={`badge ${esActivo ? 'badge-success' : 'badge-neutral'}`}>{esActivo ? 'Activo' : 'Baja'}</span>
          </div>
          <div className="det-meta-row">
            {empleado.cargo && <span><strong>{empleado.cargo}</strong>{empleado.departamento ? ` · ${empleado.departamento}` : ''}</span>}
            <span>{empresa}</span>
            {empleado.documento && <span>CI: <strong>{empleado.documento}</strong></span>}
          </div>
        </div>
        <div className="det-actions">
          <button onClick={() => setShowEdit(true)} className="btn btn-secondary"><Pencil size={14} strokeWidth={2} /> Editar</button>
          <RowActions>
            {data.empresas.length > 1 && esActivo && (
              <button className="row-actions-item" onClick={() => setCopiar(true)}><Copy size={15} strokeWidth={2} /> Copiar a otra empresa</button>
            )}
            {esActivo
              ? <button className="row-actions-item" onClick={() => setShowBaja(true)}><UserMinus size={15} strokeWidth={2} /> Dar de baja</button>
              : <button className="row-actions-item" onClick={reactivar} disabled={isPending}><RotateCcw size={15} strokeWidth={2} /> Reactivar</button>}
            <button className="row-actions-item row-actions-item-danger" onClick={() => setShowDelete(true)} disabled={isPending}><Trash2 size={15} strokeWidth={2} /> Eliminar</button>
          </RowActions>
        </div>
      </div>

      {/* Datos */}
      <div className="det-card">
        <div className="det-field-grid">
          <Campo label="Teléfono"        value={empleado.telefono} />
          <Campo label="Email"           value={empleado.email} />
          <Campo label="Dirección"       value={empleado.direccion} />
          <Campo label="Tipo de contrato" value={TIPO_CONTRATO_LABEL[empleado.tipo_contrato]} />
          <Campo label="Periodicidad"    value={PERIODICIDAD_LABEL[empleado.periodicidad]} />
          <Campo label="Salario base"    value={empleado.salario_base > 0 ? `${formatMonto(empleado.salario_base)} ${empleado.moneda}` : null} />
          <Campo label="Fecha de alta"   value={formatFecha(empleado.fecha_alta)} />
          {!esActivo && <Campo label="Fecha de baja" value={formatFecha(empleado.fecha_baja)} />}
          {!esActivo && <Campo label="Motivo de baja" value={empleado.motivo_baja} />}
        </div>
        {empleado.notas && (
          <div className="mt-3">
            <div className="det-label">Notas</div>
            <div className="det-value det-value-pre">{empleado.notas}</div>
          </div>
        )}
      </div>

      {/* Contratos */}
      <div className="det-card">
        <div className="card-header">
          <h2 className="card-title">Contratos</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNuevo(true)}>
            <Plus size={14} strokeWidth={2.5} /> Nuevo contrato
          </button>
        </div>
        {contratos.length === 0 ? (
          <div className="mon-empty">
            <FileText size={36} strokeWidth={1} opacity={0.2} />
            <p>Sin contratos. Adjunta el PDF del contrato del empleado (puede tener varios).</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Vigencia</th>
                  <th>Documento</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {contratos.map(c => (
                  <tr key={c.contrato_id}>
                    <td data-label="Tipo">
                      {TIPO_CONTRATO_LABEL[c.tipo_contrato]}
                      <div className="text-sm-muted">{PERIODICIDAD_LABEL[c.periodicidad]}{c.notas ? ` · ${c.notas}` : ''}</div>
                    </td>
                    <td data-label="Vigencia" className="text-sm-muted tes-nowrap">{formatFecha(c.fecha_inicio)} – {c.fecha_fin ? formatFecha(c.fecha_fin) : 'sin fin'}</td>
                    <td data-label="Documento">
                      {c.pdf_url
                        ? <a href={c.pdf_url} target="_blank" rel="noopener noreferrer" className="link-primary det-meta-inline"><FileText size={14} strokeWidth={2} /> Ver PDF</a>
                        : <span className="text-faint">Sin PDF</span>}
                    </td>
                    <td className="col-actions">
                      <div className="ter-actions">
                        <button className="ter-action-btn" title="Editar contrato"
                          onClick={() => setEditContrato(c)} disabled={isPending}><Pencil size={14} strokeWidth={2} /></button>
                        <button className="ter-action-btn ter-action-danger" title="Eliminar contrato"
                          onClick={() => setDelContrato(c)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Conceptos recurrentes */}
      <ConceptosSection empleadoId={empleado.empleado_id} moneda={empleado.moneda}
        conceptos={conceptos} desfasadas={desfasadas} onChanged={refrescar} />

      {/* Incidencias del mes */}
      <IncidenciasSection empleadoId={empleado.empleado_id} moneda={empleado.moneda}
        incidencias={incidencias} esCuba={esCuba} vacaciones={vacaciones}
        onChanged={refrescar} />

      {/* Nómina del trabajador */}
      <div className="det-card">
        <div className="card-header"><h2 className="card-title">Sus nóminas</h2></div>
        {miNomina.length === 0 ? (
          <div className="mon-empty">
            <Wallet size={36} strokeWidth={1} opacity={0.2} />
            <p>Este empleado aún no aparece en ninguna nómina. La nómina general se monta en la página Nómina.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="col-num">Devengado</th>
                  <th className="col-num">Deducciones</th>
                  <th className="col-num">Neto</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {nominaItems.map(({ nomina, linea }) => (
                  <tr key={nomina.nomina_id} className="table-row-clickable"
                    onClick={() => router.push(`/portal/nomina/${nomina.nomina_id}`)}>
                    <td data-label="Período"><strong>{formatPeriodo(nomina.periodo)}</strong></td>
                    <td data-label="Devengado" className="col-num tes-monto-cell">{formatMonto(linea.devengado)} {nomina.moneda}</td>
                    <td data-label="Deducciones" className="col-num tes-monto-cell">{formatMonto(linea.deducciones)}</td>
                    <td data-label="Neto" className="col-num tes-monto-cell">{formatMonto(linea.neto)} {nomina.moneda}</td>
                    <td data-label="Estado">
                      <span className={`badge ${nomina.estado === 'BORRADOR' ? 'badge-warning' : (nomina.saldo_pendiente <= 0.005 ? 'badge-success' : 'badge-info')}`}>
                        {nomina.estado === 'BORRADOR' ? 'Borrador' : (nomina.saldo_pendiente <= 0.005 ? 'Pagada' : 'Pendiente de pago')}
                      </span>
                    </td>
                    {/* Descarga directa, no un desplegable de un solo elemento: la fila
                        entera ya lleva a la hoja de nómina al pulsarla, así que «Ver
                        detalle» era el menú repitiendo lo que hace el clic. */}
                    <td className="col-actions">
                      <button className="btn btn-ghost btn-sm"
                        onClick={e => { e.stopPropagation(); descargarRecibo(nomina) }}
                        disabled={reciboDe !== null}
                        title="Descargar el recibo de este período en PDF">
                        <Download size={15} strokeWidth={2} />
                        {reciboDe === nomina.nomina_id ? 'Generando…' : 'Recibo'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...nominaPag} label="nómina" />
      </div>

      {/* Modales */}
      {showEdit && (
        <EmpleadoModal empleado={empleado} data={data}
          onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); refrescar() }} />
      )}
      {copiar && (
        <CopiarAEmpresaModal
          titulo="Copiar a otra empresa"
          descripcion="Se creará un empleado independiente en esa empresa, con su propio contrato."
          empresas={data.empresas.filter(x => x.empresa_id !== empleado.empresa_id)}
          monedas={data.monedas}
          monedaOrigen={empleado.moneda}
          empresaOrigen={data.empresa_nombres[empleado.empresa_id] ?? 'su empresa actual'}
          importe={{ label: 'Salario base', valor: empleado.salario_base, seConvierte: false }}
          tasas={data.tasas}
          onCopiar={(empresaId, moneda, salario) =>
            copiarEmpleadoAEmpresa(empleado.empleado_id, empresaId, moneda, salario)}
          onClose={() => setCopiar(false)}
          onCopiado={() => setCopiar(false)}
        />
      )}
      {showBaja && (
        <BajaModal empleado={empleado} onClose={() => setShowBaja(false)} onSaved={() => { setShowBaja(false); refrescar() }} />
      )}
      {showDelete && (
        <ConfirmEliminar empleado={empleado} onConfirm={confirmarEliminar}
          onClose={() => setShowDelete(false)} isPending={isPending} />
      )}
      {showNuevo && (
        <ContratoModal empleadoId={empleado.empleado_id}
          onClose={() => setShowNuevo(false)} onSaved={() => { setShowNuevo(false); refrescar() }} />
      )}
      {editContrato && (
        <ContratoModal empleadoId={empleado.empleado_id} contrato={editContrato}
          onClose={() => setEditContrato(null)} onSaved={() => { setEditContrato(null); refrescar() }} />
      )}
      {delContrato && (
        <div className="modal-backdrop open">
          <div className="modal modal-sm" role="dialog" aria-modal>
            <div className="modal-header">
              <h2 className="modal-title">Eliminar contrato</h2>
              <button type="button" className="modal-close" onClick={() => setDelContrato(null)}><X size={16} strokeWidth={2} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-body-text">¿Eliminar este contrato{delContrato.pdf_nombre ? ` y su PDF (${delContrato.pdf_nombre})` : ''}? No se puede deshacer.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setDelContrato(null)}>Cancelar</button>
              <button type="button" className="btn btn-danger" onClick={confirmarDelContrato} disabled={isPending}>
                {isPending ? <><span className="spinner spinner-sm" /> Eliminando…</> : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
