'use client'

import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
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
  confirmarNomina,
  type EmpleadoDetalleData,
  type Contrato,
  type ConceptoEmpleado,
  type TipoContrato,
  type Periodicidad,
  type NominaConLineas,
} from '@/app/actions/portal/rrhh'
import { EmpleadoModal, BajaModal, ConfirmEliminar } from '../PersonalView'
import { RowActions } from '@/components/portal/RowActions'
import CopiarAEmpresaModal from '@/components/portal/CopiarAEmpresaModal'
import { Copy, FileText, Eye, Pencil, Plus, RotateCcw, Trash2, UserMinus, Wallet, X } from 'lucide-react'
import { usePagination, TablePagination } from '@/components/TablePagination'
import {
  NominaDetalleModal,
  ConfirmarNominaModal,
  PagarNominaModal,
  formatMonto,
  hoyISO as hoyISOShared,
  formatPeriodo,
} from '../../_shared/NominaDetalleModal'

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

// ── Conceptos recurrentes (bonos/deducciones fijos) ─────────────────────────────

function ConceptosSection({
  empleadoId, moneda, conceptos, onChanged,
}: {
  empleadoId: string
  moneda:     string
  conceptos:  ConceptoEmpleado[]
  onChanged:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [delId, setDelId] = useState<string | null>(null)

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    fd.set('empleado_id', empleadoId)
    const ld = toastLoading('Añadiendo…')
    startTransition(async () => {
      const res = await guardarConceptoEmpleado(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      form.reset()
      onChanged()
    })
  }

  function handleDel(id: string) {
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarConceptoEmpleado(id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelId(null); return }
      setDelId(null); onChanged()
    })
  }

  return (
    <div className="det-card">
      <div className="card-header"><h2 className="card-title">Conceptos recurrentes</h2></div>
      <p className="text-sm-muted mb-3">Bonos y deducciones fijos del trabajador. Se aplican solos al generar la nómina.</p>

      <form className="nom-aplicar" onSubmit={handleAdd}>
        <input className="input nom-aplicar-nombre" name="nombre" placeholder="Nombre (ej: Transporte)" required aria-label="Nombre del concepto" />
        <select className="input nom-aplicar-sel" name="tipo" defaultValue="DEDUCCION" aria-label="Tipo">
          <option value="DEDUCCION">Deducción</option>
          <option value="BONO">Bono</option>
        </select>
        <select className="input nom-aplicar-sel" name="modo" defaultValue="FIJO" aria-label="Modo">
          <option value="FIJO">Fijo ({moneda})</option>
          <option value="PORCENTAJE">% del salario</option>
        </select>
        <input className="input nom-aplicar-val" name="valor" type="number" min="0" step="0.01" placeholder="0.00" required aria-label="Valor" />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={isPending}>
          {isPending ? <span className="spinner spinner-sm" /> : <><Plus size={14} strokeWidth={2.5} /> Añadir</>}
        </button>
      </form>

      {conceptos.length > 0 && (
        <div className="table-wrapper mt-3">
          <table className="table">
            <thead>
              <tr><th>Concepto</th><th>Tipo</th><th className="col-num">Valor</th><th className="col-actions"></th></tr>
            </thead>
            <tbody>
              {conceptos.map(c => (
                <tr key={c.concepto_id}>
                  <td data-label="Concepto"><strong>{c.nombre}</strong></td>
                  <td data-label="Tipo"><span className={`badge ${c.tipo === 'BONO' ? 'badge-success' : 'badge-warning'}`}>{c.tipo === 'BONO' ? 'Bono' : 'Deducción'}</span></td>
                  <td data-label="Valor" className="col-num tes-monto-cell">{c.modo === 'PORCENTAJE' ? `${c.valor}%` : `${c.valor.toLocaleString('es-ES', { minimumFractionDigits: 2 })} ${moneda}`}</td>
                  <td className="col-actions">
                    <div className="ter-actions">
                      {delId === c.concepto_id ? (
                        <>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDel(c.concepto_id)} disabled={isPending}>Confirmar</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setDelId(null)} disabled={isPending}>No</button>
                        </>
                      ) : (
                        <button className="ter-action-btn ter-action-danger" title="Eliminar"
                          onClick={() => setDelId(c.concepto_id)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
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
  )
}

// ── Vista de detalle del empleado ────────────────────────────────────────────────

export default function EmpleadoDetalleView({ detalle }: { detalle: EmpleadoDetalleData }) {
  const router = useRouter()
  const { data, empleado, contratos, conceptos } = detalle
  const [isPending, startTransition] = useTransition()

  const [showEdit,      setShowEdit]      = useState(false)
  const [copiar,        setCopiar]        = useState(false)
  const [showBaja,      setShowBaja]      = useState(false)
  const [showDelete,    setShowDelete]    = useState(false)
  const [showNuevo,     setShowNuevo]     = useState(false)
  const [editContrato,  setEditContrato]  = useState<Contrato | null>(null)
  const [delContrato,   setDelContrato]   = useState<Contrato | null>(null)
  const [detalleNominaId, setDetalleNominaId] = useState<string | null>(null)
  const [confirmarNom,  setConfirmarNom]  = useState<NominaConLineas | null>(null)
  const [pagarNom,      setPagarNom]      = useState<NominaConLineas | null>(null)

  const nombre   = [empleado.nombre, empleado.apellidos].filter(Boolean).join(' ')
  const empresa  = data.empresa_nombres[empleado.empresa_id] ?? '—'
  const esActivo = empleado.estado === 'ACTIVO'

  // Nómina de este trabajador: su línea en cada nómina donde aparece
  const miNomina = data.nominas.flatMap(n => {
    const l = n.lineas.find(x => x.empleado_id === empleado.empleado_id)
    return l ? [{ nomina: n, linea: l }] : []
  })
  const { pageItems: nominaItems, ...nominaPag } = usePagination(miNomina)

  const detalleVivo = useMemo(() =>
    detalleNominaId ? data.nominas.find(n => n.nomina_id === detalleNominaId) ?? null : null,
    [detalleNominaId, data.nominas])

  function refrescar() { router.refresh() }

  function doConfirmarNomina() {
    if (!confirmarNom) return
    const ld = toastLoading('Confirmando…')
    startTransition(async () => {
      const res = await confirmarNomina(confirmarNom.nomina_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      setConfirmarNom(null); router.refresh()
    })
  }

  function reactivar() {
    const ld = toastLoading('Reactivando…')
    startTransition(async () => {
      const res = await reactivarEmpleado(empleado.empleado_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      router.refresh()
    })
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
        conceptos={conceptos} onChanged={refrescar} />

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
                    onClick={() => setDetalleNominaId(nomina.nomina_id)}>
                    <td data-label="Período"><strong>{formatPeriodo(nomina.periodo)}</strong></td>
                    <td data-label="Devengado" className="col-num tes-monto-cell">{formatMonto(linea.devengado)} {nomina.moneda}</td>
                    <td data-label="Deducciones" className="col-num tes-monto-cell">{formatMonto(linea.deducciones)}</td>
                    <td data-label="Neto" className="col-num tes-monto-cell">{formatMonto(linea.neto)} {nomina.moneda}</td>
                    <td data-label="Estado">
                      <span className={`badge ${nomina.estado === 'BORRADOR' ? 'badge-warning' : (nomina.saldo_pendiente <= 0.005 ? 'badge-success' : 'badge-info')}`}>
                        {nomina.estado === 'BORRADOR' ? 'Borrador' : (nomina.saldo_pendiente <= 0.005 ? 'Pagada' : 'Pendiente de pago')}
                      </span>
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => setDetalleNominaId(nomina.nomina_id)}><Eye size={15} strokeWidth={2} /> Ver detalle</button>
                      </RowActions>
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
      {detalleVivo && (
        <NominaDetalleModal nomina={detalleVivo} empleadoId={empleado.empleado_id}
          onClose={() => setDetalleNominaId(null)}
          onChanged={() => router.refresh()}
          onConfirmar={() => setConfirmarNom(detalleVivo)}
          onPagar={() => { setPagarNom(detalleVivo); setDetalleNominaId(null) }} />
      )}
      {confirmarNom && (
        <ConfirmarNominaModal nomina={confirmarNom} onConfirm={doConfirmarNomina}
          onClose={() => setConfirmarNom(null)} isPending={isPending} />
      )}
      {pagarNom && (
        <PagarNominaModal nomina={pagarNom} cuentas={data.cuentas}
          onClose={() => setPagarNom(null)} onPaid={() => { setPagarNom(null); router.refresh() }} />
      )}
    </div>
  )
}
