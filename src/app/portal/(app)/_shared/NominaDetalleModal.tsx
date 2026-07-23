'use client'

import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition } from 'react'
import {
  guardarLineaNomina,
  aplicarConceptoNomina,
  type NominaConLineas,
  type NominaLinea,
} from '@/app/actions/portal/rrhh'
import { registrarLiquidacion } from '@/app/actions/portal/gastos'
import LiquidarCuentaFields, { type LiquidarState } from '@/app/portal/(app)/_shared/LiquidarCuentaFields'
import { Check, CircleCheck, DollarSign, Wallet, X } from 'lucide-react'

type CuentaInfo = { cuenta_id: string; nombre: string; empresa_id: string; moneda: string }

export function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function hoyISO(): string { return new Date().toISOString().split('T')[0] }
export function formatPeriodo(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m) return periodo
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

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
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarLineaNomina(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  return (
    <tr>
      <td data-label="Empleado">
        <strong>{linea.empleado_nombre}</strong>
        {linea.cargo && <div className="text-sm-muted">{linea.cargo}</div>}
      </td>
      <td data-label="Devengado" className="col-num"><input className="input nom-input" type="number" min="0" step="any" value={dev}
        onChange={e => setDev(e.target.value)} aria-label={`Devengado de ${linea.empleado_nombre}`} /></td>
      <td data-label="Deducciones" className="col-num"><input className="input nom-input" type="number" min="0" step="any" value={ded}
        onChange={e => setDed(e.target.value)} aria-label={`Deducciones de ${linea.empleado_nombre}`} /></td>
      <td data-label="Neto" className="col-num tes-monto-cell">{formatMonto(netoLive)} {moneda}</td>
      <td className="col-actions">
        <button type="button" className="ter-action-btn ter-action-restore" title="Guardar línea"
          onClick={save} disabled={isPending || !dirty}><Check size={15} strokeWidth={2} /></button>
      </td>
    </tr>
  )
}

function AplicarATodas({
  nominaId, moneda, onChanged,
}: {
  nominaId:  string
  moneda:    string
  onChanged: () => void
}) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    fd.set('nomina_id', nominaId)
    const ld = toastLoading('Aplicando…')
    startTransition(async () => {
      const res = await aplicarConceptoNomina(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      form.reset()
      onChanged()
    })
  }

  return (
    <form className="nom-aplicar" onSubmit={handleSubmit}>
      <span className="nom-aplicar-label">Aplicar a todas</span>
      <select className="input nom-aplicar-sel" name="concepto" defaultValue="DEDUCCION" aria-label="Concepto">
        <option value="DEDUCCION">Deducción</option>
        <option value="BONO">Bono</option>
      </select>
      <select className="input nom-aplicar-sel" name="modo" defaultValue="FIJO" aria-label="Modo">
        <option value="FIJO">Fijo ({moneda})</option>
        <option value="PORCENTAJE">% del devengado</option>
      </select>
      <input className="input nom-aplicar-val" name="valor" type="number" min="0" step="any" placeholder="0.00" required aria-label="Valor" />
      <button type="submit" className="btn btn-secondary btn-sm" disabled={isPending}>
        {isPending ? <span className="spinner spinner-sm" /> : 'Aplicar'}
      </button>
    </form>
  )
}

export function NominaDetalleModal({
  nomina, onClose, onChanged, onConfirmar, onPagar, empleadoId,
}: {
  nomina:      NominaConLineas
  onClose:     () => void
  onChanged:   () => void
  onConfirmar: () => void
  onPagar:     () => void
  empleadoId?: string
}) {
  const esBorrador = nomina.estado === 'BORRADOR'

  const lineasVisibles = empleadoId
    ? nomina.lineas.filter(l => l.empleado_id === empleadoId)
    : nomina.lineas
  const totalVisible = empleadoId
    ? lineasVisibles.reduce((s, l) => s + l.neto, 0)
    : nomina.total
  const esVistaIndividual = !!empleadoId

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
                  : `Gasto registrado · Pagado ${formatMonto(nomina.pagado)} · Pendiente ${formatMonto(nomina.saldo_pendiente)} ${nomina.moneda}. Usa el botón Pagar para liquidar.`}
            </span>
          </div>

          {esBorrador && !esVistaIndividual && lineasVisibles.length > 0 && (
            <AplicarATodas nominaId={nomina.nomina_id} moneda={nomina.moneda} onChanged={onChanged} />
          )}

          {lineasVisibles.length === 0 ? (
            <div className="mon-empty"><Wallet size={32} strokeWidth={1} opacity={0.2} /><p>Esta nómina no tiene líneas.</p></div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th className="col-num">Devengado</th>
                    <th className="col-num">Deducciones</th>
                    <th className="col-num">Neto</th>
                    {esBorrador && <th className="col-actions"></th>}
                  </tr>
                </thead>
                <tbody>
                  {esBorrador
                    ? lineasVisibles.map(l => (
                        <LineaEditableRow key={l.linea_id} linea={l} moneda={nomina.moneda} onChanged={onChanged} />
                      ))
                    : lineasVisibles.map(l => (
                        <tr key={l.linea_id}>
                          <td data-label="Empleado"><strong>{l.empleado_nombre}</strong>{l.cargo && <div className="text-sm-muted">{l.cargo}</div>}</td>
                          <td data-label="Devengado" className="col-num tes-monto-cell">{formatMonto(l.devengado)}</td>
                          <td data-label="Deducciones" className="col-num tes-monto-cell">{formatMonto(l.deducciones)}</td>
                          <td data-label="Neto" className="col-num tes-monto-cell">{formatMonto(l.neto)} {nomina.moneda}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="nom-total">
            <span>{esVistaIndividual ? 'Neto del trabajador' : 'Total nómina'}</span>
            <strong>{formatMonto(totalVisible)} {nomina.moneda}</strong>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          {esBorrador ? (
            <button type="button" className="btn btn-primary" onClick={onConfirmar}>
              <CircleCheck size={15} strokeWidth={2} /> Confirmar nómina
            </button>
          ) : nomina.gasto_id && nomina.saldo_pendiente > 0.005 ? (
            <button type="button" className="btn btn-primary" onClick={onPagar}>
              <DollarSign size={15} strokeWidth={2} /> Pagar
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function ConfirmarNominaModal({
  nomina, onConfirm, onClose, isPending,
}: {
  nomina:    NominaConLineas
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Confirmar nómina</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            Se registrará un gasto <strong>«Salarios»</strong> de <strong>{formatMonto(nomina.total)} {nomina.moneda}</strong> en
            Gastos y cobros (nómina de {formatPeriodo(nomina.periodo)}), que podrás pagar con el botón Pagar y aparecerá en
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

export function PagarNominaModal({
  nomina, cuentas, onClose, onPaid,
}: {
  nomina:  NominaConLineas
  cuentas: CuentaInfo[]
  onClose: () => void
  onPaid:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  // Todas las cajas (sin filtrar por empresa ni por moneda): la de la misma
  // moneda aparece primero; si eliges otra, LiquidarCuentaFields aplica la tasa.
  const cuentasOrdenadas = [...cuentas].sort((a, b) =>
    (a.moneda === nomina.moneda ? 0 : 1) - (b.moneda === nomina.moneda ? 0 : 1))
  const [liq, setLiq]  = useState<LiquidarState | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!liq || !liq.valido) return
    const fd = new FormData(e.currentTarget)
    fd.set('registro_id', nomina.gasto_id ?? '')
    fd.set('cuenta_id', liq.cuentaId)
    fd.set('monto', liq.monto)
    fd.set('tasa_cambio', String(liq.tasa))
    const ld = toastLoading('Registrando…')
    startTransition(async () => {
      const res = await registrarLiquidacion(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onPaid()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Pagar nómina {formatPeriodo(nomina.periodo)}</h2>
            <p className="text-xs-muted mt-1">
              Salarios · Total {formatMonto(nomina.total)} {nomina.moneda} ·
              Pendiente <strong>{formatMonto(nomina.saldo_pendiente)} {nomina.moneda}</strong>
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          {cuentasOrdenadas.length === 0 ? (
            <div className="alert alert-warning">No tienes cajas disponibles. Crea una en Tesorería para registrar el pago.</div>
          ) : (
            <form id="pagar-nomina-form" onSubmit={handleSubmit} className="gc-liq-form">
              <div className="ter-form-grid">
                <LiquidarCuentaFields
                  cuentas={cuentasOrdenadas}
                  docMoneda={nomina.moneda}
                  saldo={nomina.saldo_pendiente}
                  onChange={setLiq}
                />
                <div className="input-group ter-col-span-3">
                  <label>Fecha <span className="required">*</span></label>
                  <input className="input" name="fecha" type="date" required defaultValue={hoyISO()} />
                </div>
                <div className="input-group ter-col-full">
                  <label>Notas</label>
                  <input className="input" name="notas" placeholder="Referencia…" />
                </div>
              </div>
            </form>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          {cuentasOrdenadas.length > 0 && (
            <button type="submit" form="pagar-nomina-form" className="btn btn-primary" disabled={isPending || !liq?.valido}>
              {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : 'Registrar pago'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
