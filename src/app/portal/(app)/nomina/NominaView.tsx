'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition } from 'react'
import { useRouter }               from 'next/navigation'
import {
  crearNomina,
  guardarLineaNomina,
  confirmarNomina,
  eliminarNomina,
  type NominaConLineas,
  type NominaLinea,
  type RrhhPageData,
} from '@/app/actions/portal/rrhh'
import { Check, CircleCheck, Pencil, Plus, Trash2, Wallet, X } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function hoyISO(): string { return new Date().toISOString().split('T')[0] }
function formatPeriodo(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m) return periodo
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function mesActual(): string {
  return new Date().toISOString().slice(0, 7)
}

// ── Modal: nueva nómina ──────────────────────────────────────────────────────────

function NuevaNominaModal({
  data, onClose, onSaved,
}: {
  data:    RrhhPageData
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await crearNomina(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Nueva nómina</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-body-text">Se creará un borrador con una línea por cada empleado activo de la empresa cuyo salario esté en la moneda elegida. Podrás ajustar el devengado y las deducciones antes de confirmar.</p>
            <div className="ter-form-grid">
              <div className="input-group ter-col-span-3">
                <label>Período <span className="required">*</span></label>
                <input className="input" name="periodo" type="month" required defaultValue={mesActual()} />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Fecha <span className="required">*</span></label>
                <input className="input" name="fecha" type="date" required defaultValue={hoyISO()} />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Empresa <span className="required">*</span></label>
                {data.empresas.length === 1 ? (
                  <>
                    <input className="input input-static" readOnly value={data.empresas[0].nombre} />
                    <input type="hidden" name="empresa_id" value={data.empresas[0].empresa_id} />
                  </>
                ) : (
                  <select className="input" name="empresa_id" defaultValue="" required>
                    <option value="" disabled>Selecciona…</option>
                    {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
                  </select>
                )}
              </div>
              <div className="input-group ter-col-span-3">
                <label>Moneda <span className="required">*</span></label>
                {data.monedas.length === 0 ? (
                  <>
                    <input className="input input-static" readOnly value="Sin monedas activas" />
                    <span className="input-hint">Crea una moneda en Monedas y Tasas primero.</span>
                  </>
                ) : (
                  <select className="input" name="moneda" defaultValue="" required>
                    <option value="" disabled>Selecciona…</option>
                    {data.monedas.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </div>
              <div className="input-group ter-col-full">
                <label>Notas</label>
                <input className="input" name="notas" placeholder="Quincena, observaciones…" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || data.monedas.length === 0}>
              {isPending ? <><span className="spinner spinner-sm" /> Creando…</> : 'Crear borrador'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Fila editable de una línea de nómina (solo en borrador) ──────────────────────

function LineaEditableRow({
  linea, moneda, onChanged,
}: {
  linea:     NominaLinea
  moneda:    string
  onChanged: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [dev, setDev] = useState(String(linea.devengado))
  const [ded, setDed] = useState(String(linea.deducciones))

  const netoLive = Math.max(0, (parseFloat(dev) || 0) - (parseFloat(ded) || 0))
  const dirty    = (parseFloat(dev) || 0) !== linea.devengado || (parseFloat(ded) || 0) !== linea.deducciones

  function save() {
    const fd = new FormData()
    fd.set('linea_id', linea.linea_id)
    fd.set('devengado', dev)
    fd.set('deducciones', ded)
    startTransition(async () => {
      const res = await guardarLineaNomina(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  return (
    <tr>
      <td>
        <strong>{linea.empleado_nombre}</strong>
        {linea.cargo && <div className="text-sm-muted">{linea.cargo}</div>}
      </td>
      <td><input className="input nom-input" type="number" min="0" step="0.01" value={dev}
        onChange={e => setDev(e.target.value)} aria-label={`Devengado de ${linea.empleado_nombre}`} /></td>
      <td><input className="input nom-input" type="number" min="0" step="0.01" value={ded}
        onChange={e => setDed(e.target.value)} aria-label={`Deducciones de ${linea.empleado_nombre}`} /></td>
      <td className="tes-col-monto tes-monto-cell">{formatMonto(netoLive)} {moneda}</td>
      <td>
        <button type="button" className="ter-action-btn ter-action-restore" title="Guardar línea"
          onClick={save} disabled={isPending || !dirty}><Check size={15} strokeWidth={2} /></button>
      </td>
    </tr>
  )
}

// ── Modal: detalle de nómina (líneas + confirmar) ────────────────────────────────

function NominaDetalleModal({
  nomina, onClose, onChanged, onConfirmar,
}: {
  nomina:      NominaConLineas
  onClose:     () => void
  onChanged:   () => void
  onConfirmar: () => void
}) {
  const esBorrador = nomina.estado === 'BORRADOR'

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Nómina {formatPeriodo(nomina.periodo)}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="info-box">
            <strong className="info-box-title">
              {formatPeriodo(nomina.periodo)} · {nomina.moneda}
              {' '}<span className={`badge ${esBorrador ? 'badge-warning' : 'badge-success'}`}>{esBorrador ? 'Borrador' : 'Confirmada'}</span>
            </strong>
            <span className="text-xs-muted">
              {esBorrador
                ? 'Ajusta devengado y deducciones; guarda cada línea. Al confirmar se registra el gasto de salarios.'
                : nomina.saldo_pendiente <= 0.005
                  ? 'Confirmada y pagada por completo.'
                  : `Gasto registrado · Pagado ${formatMonto(nomina.pagado)} · Pendiente ${formatMonto(nomina.saldo_pendiente)} ${nomina.moneda} (págalo desde Tesorería).`}
            </span>
          </div>

          {nomina.lineas.length === 0 ? (
            <div className="mon-empty"><Wallet size={32} strokeWidth={1} opacity={0.2} /><p>Esta nómina no tiene líneas.</p></div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Devengado</th>
                    <th>Deducciones</th>
                    <th className="tes-col-monto">Neto</th>
                    {esBorrador && <th className="alm-col-act"></th>}
                  </tr>
                </thead>
                <tbody>
                  {esBorrador
                    ? nomina.lineas.map(l => (
                        <LineaEditableRow key={l.linea_id} linea={l} moneda={nomina.moneda} onChanged={onChanged} />
                      ))
                    : nomina.lineas.map(l => (
                        <tr key={l.linea_id}>
                          <td><strong>{l.empleado_nombre}</strong>{l.cargo && <div className="text-sm-muted">{l.cargo}</div>}</td>
                          <td className="tes-monto-cell">{formatMonto(l.devengado)}</td>
                          <td className="tes-monto-cell">{formatMonto(l.deducciones)}</td>
                          <td className="tes-col-monto tes-monto-cell">{formatMonto(l.neto)} {nomina.moneda}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="nom-total">
            <span>Total nómina</span>
            <strong>{formatMonto(nomina.total)} {nomina.moneda}</strong>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          {esBorrador && (
            <button type="button" className="btn btn-primary" onClick={onConfirmar}>
              <CircleCheck size={15} strokeWidth={2} /> Confirmar nómina
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal: confirmar nómina (acción crítica) ─────────────────────────────────────

function ConfirmarNominaModal({
  nomina, onConfirm, onClose, isPending,
}: {
  nomina:    NominaConLineas
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Confirmar nómina</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            Se registrará un gasto <strong>«Salarios»</strong> de <strong>{formatMonto(nomina.total)} {nomina.moneda}</strong> en
            Gastos y cobros (nómina de {formatPeriodo(nomina.periodo)}), que podrás pagar desde Tesorería y aparecerá en
            Cuentas por pagar y Reportes. La nómina dejará de ser editable.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Confirmando…</> : 'Confirmar y registrar gasto'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Confirmación eliminar nómina ─────────────────────────────────────────────────

function ConfirmEliminarNomina({
  nomina, onConfirm, onClose, isPending,
}: {
  nomina:    NominaConLineas
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Eliminar nómina</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            ¿Eliminar la nómina de <strong>{formatPeriodo(nomina.periodo)}</strong> ({formatMonto(nomina.total)} {nomina.moneda})?
            {nomina.estado === 'CONFIRMADA' && ' También se eliminará el gasto de salarios asociado.'}
          </p>
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

// ── Página: Nómina ───────────────────────────────────────────────────────────────

export default function NominaView({ data }: { data: RrhhPageData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [modalNuevaNomina, setModalNuevaNomina] = useState(false)
  const [detalleNominaId,  setDetalleNominaId]  = useState<string | null>(null)
  const [confirmarNom,     setConfirmarNom]     = useState<NominaConLineas | null>(null)
  const [delNomina,        setDelNomina]        = useState<NominaConLineas | null>(null)

  // Re-sincroniza la nómina abierta en el detalle tras un refresh
  const detalleVivo = detalleNominaId
    ? data.nominas.find(n => n.nomina_id === detalleNominaId) ?? null
    : null

  function onNominaCreada() { setModalNuevaNomina(false); router.refresh() }

  function doConfirmarNomina() {
    if (!confirmarNom) return
    startTransition(async () => {
      const res = await confirmarNomina(confirmarNom.nomina_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      setConfirmarNom(null); router.refresh()
    })
  }

  function doEliminarNomina() {
    if (!delNomina) return
    startTransition(async () => {
      const res = await eliminarNomina(delNomina.nomina_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setDelNomina(null); return }
      setDelNomina(null); setDetalleNominaId(null); router.refresh()
    })
  }

  return (
    <div className="view-container">

      <div className="page-header">
        <div>
          <h1 className="page-title">Nómina</h1>
          <p className="page-subtitle">Nómina simple del personal. Al confirmar se registra como gasto de salarios en tu contabilidad.</p>
        </div>
        <div className="tes-header-actions">
          <button className="btn btn-primary" onClick={() => setModalNuevaNomina(true)} disabled={data.empresas.length === 0}>
            <Plus size={14} strokeWidth={2.5} /> Nueva nómina
          </button>
        </div>
      </div>

      <div className="card card-table">
        {data.nominas.length === 0 ? (
          <div className="mon-empty">
            <Wallet size={40} strokeWidth={1} opacity={0.2} />
            <p>Aún no hay nóminas. Crea la primera para pagar a tu personal activo; al confirmarla se registra como gasto de salarios en tu contabilidad.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Período</th>
                  {data.empresas.length > 1 && <th>Empresa</th>}
                  <th>Empleados</th>
                  <th className="tes-col-monto">Total</th>
                  <th>Estado</th>
                  <th className="alm-col-act"></th>
                </tr>
              </thead>
              <tbody>
                {data.nominas.map(n => (
                  <tr key={n.nomina_id} className="table-row-clickable" onClick={() => setDetalleNominaId(n.nomina_id)}>
                    <td><strong>{formatPeriodo(n.periodo)}</strong></td>
                    {data.empresas.length > 1 && <td className="text-sm-muted">{data.empresa_nombres[n.empresa_id] ?? '—'}</td>}
                    <td className="text-sm-muted">{n.lineas.length}</td>
                    <td className="tes-col-monto tes-monto-cell">{formatMonto(n.total)} {n.moneda}</td>
                    <td>
                      <span className={`badge ${n.estado === 'BORRADOR' ? 'badge-warning' : (n.saldo_pendiente <= 0.005 ? 'badge-success' : 'badge-info')}`}>
                        {n.estado === 'BORRADOR' ? 'Borrador' : (n.saldo_pendiente <= 0.005 ? 'Pagada' : 'Pendiente de pago')}
                      </span>
                    </td>
                    <td>
                      <div className="ter-actions" onClick={e => e.stopPropagation()}>
                        <button className="ter-action-btn" title="Ver detalle" onClick={() => setDetalleNominaId(n.nomina_id)}><Pencil size={15} strokeWidth={2} /></button>
                        <button className="ter-action-btn ter-action-danger" title="Eliminar"
                          onClick={() => setDelNomina(n)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalNuevaNomina && (
        <NuevaNominaModal data={data} onClose={() => setModalNuevaNomina(false)} onSaved={onNominaCreada} />
      )}
      {detalleVivo && (
        <NominaDetalleModal nomina={detalleVivo}
          onClose={() => setDetalleNominaId(null)}
          onChanged={() => router.refresh()}
          onConfirmar={() => setConfirmarNom(detalleVivo)} />
      )}
      {confirmarNom && (
        <ConfirmarNominaModal nomina={confirmarNom} onConfirm={doConfirmarNomina}
          onClose={() => setConfirmarNom(null)} isPending={isPending} />
      )}
      {delNomina && (
        <ConfirmEliminarNomina nomina={delNomina} onConfirm={doEliminarNomina}
          onClose={() => setDelNomina(null)} isPending={isPending} />
      )}
    </div>
  )
}
