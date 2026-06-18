'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
import { useRouter }               from 'next/navigation'
import {
  crearNomina,
  guardarLineaNomina,
  aplicarConceptoNomina,
  confirmarNomina,
  eliminarNomina,
  type NominaConLineas,
  type NominaLinea,
  type RrhhPageData,
} from '@/app/actions/portal/rrhh'
import { registrarLiquidacion } from '@/app/actions/portal/gastos'
import { Check, CircleCheck, DollarSign, Pencil, Plus, Trash2, Wallet, X } from 'lucide-react'

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
function siguienteMes(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  const d = new Date(y, m, 1)   // m (1-based) como índice 0-based = mes siguiente
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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

  // Solo combinaciones empresa→moneda que SÍ pueden generar nómina (empleados activos).
  // Así el usuario no "adivina": elige entre lo que de verdad tiene personal.
  const opciones = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of data.empleados) {
      if (e.estado !== 'ACTIVO') continue
      const arr = m.get(e.empresa_id) ?? []
      if (!arr.includes(e.moneda)) arr.push(e.moneda)
      m.set(e.empresa_id, arr)
    }
    return m
  }, [data.empleados])

  const empresasDisp = data.empresas.filter(e => opciones.has(e.empresa_id))
  const [empresaId, setEmpresaId] = useState(empresasDisp[0]?.empresa_id ?? '')
  const monedasDisp = (opciones.get(empresaId) ?? []).slice().sort()
  const [moneda, setMoneda]       = useState(monedasDisp[0] ?? '')

  // Sugerir el mes siguiente a la última nómina de la empresa (o el actual)
  const sugerir = (id: string) => {
    const ps = data.nominas.filter(n => n.empresa_id === id).map(n => n.periodo).sort()
    const last = ps[ps.length - 1]
    return last ? siguienteMes(last) : mesActual()
  }
  const [periodo, setPeriodo] = useState(sugerir(empresaId))

  function cambiarEmpresa(id: string) {
    setEmpresaId(id)
    const ms = (opciones.get(id) ?? []).slice().sort()
    setMoneda(ms[0] ?? '')
    setPeriodo(sugerir(id))
  }

  const duplicada = data.nominas.some(n => n.empresa_id === empresaId && n.periodo === periodo)
  const sinDatos  = empresasDisp.length === 0

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('empresa_id', empresaId)
    fd.set('moneda', moneda)
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
        {sinDatos ? (
          <>
            <div className="modal-body">
              <div className="alert alert-warning">No hay empleados activos con salario en ninguna empresa. Da de alta personal (con su salario) antes de generar una nómina.</div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              <p className="modal-body-text">Se creará un borrador con una línea por cada empleado activo de la empresa y moneda elegidas. Solo se muestran las que tienen personal.</p>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-3">
                  <label>Período <span className="required">*</span></label>
                  <input className="input" name="periodo" type="month" required value={periodo} onChange={e => setPeriodo(e.target.value)} />
                  {duplicada && <span className="input-hint input-hint-danger">Ya hay una nómina de este período para la empresa.</span>}
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Fecha <span className="required">*</span></label>
                  <input className="input" name="fecha" type="date" required defaultValue={hoyISO()} />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Empresa <span className="required">*</span></label>
                  {empresasDisp.length === 1 ? (
                    <input className="input input-static" readOnly value={empresasDisp[0].nombre} />
                  ) : (
                    <select className="input" value={empresaId} onChange={e => cambiarEmpresa(e.target.value)} required>
                      {empresasDisp.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
                    </select>
                  )}
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Moneda <span className="required">*</span></label>
                  {monedasDisp.length === 1 ? (
                    <input className="input input-static" readOnly value={monedasDisp[0]} />
                  ) : (
                    <select className="input" value={moneda} onChange={e => setMoneda(e.target.value)} required>
                      {monedasDisp.map(m => <option key={m} value={m}>{m}</option>)}
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
              <button type="submit" className="btn btn-primary" disabled={isPending || !empresaId || !moneda || duplicada}>
                {isPending ? <><span className="spinner spinner-sm" /> Creando…</> : 'Crear borrador'}
              </button>
            </div>
          </form>
        )}
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

// ── Aplicar un bono/deducción a TODAS las líneas ────────────────────────────────

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
    startTransition(async () => {
      const res = await aplicarConceptoNomina(fd)
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
      <input className="input nom-aplicar-val" name="valor" type="number" min="0" step="0.01" placeholder="0.00" required aria-label="Valor" />
      <button type="submit" className="btn btn-secondary btn-sm" disabled={isPending}>
        {isPending ? <span className="spinner spinner-sm" /> : 'Aplicar'}
      </button>
    </form>
  )
}

// ── Modal: detalle de nómina (líneas + confirmar) ────────────────────────────────

function NominaDetalleModal({
  nomina, onClose, onChanged, onConfirmar, onPagar,
}: {
  nomina:      NominaConLineas
  onClose:     () => void
  onChanged:   () => void
  onConfirmar: () => void
  onPagar:     () => void
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

          {esBorrador && nomina.lineas.length > 0 && (
            <AplicarATodas nominaId={nomina.nomina_id} moneda={nomina.moneda} onChanged={onChanged} />
          )}

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

// ── Modal: pagar nómina (liquidación en Tesorería del gasto de salarios) ─────────

function PagarNominaModal({
  nomina, cuentas, onClose, onPaid,
}: {
  nomina:  NominaConLineas
  cuentas: RrhhPageData['cuentas']
  onClose: () => void
  onPaid:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  const compat = cuentas.filter(c => c.moneda === nomina.moneda)
  const [cuentaId, setCuentaId] = useState(compat[0]?.cuenta_id ?? '')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('registro_id', nomina.gasto_id ?? '')
    fd.set('cuenta_id', cuentaId)
    startTransition(async () => {
      const res = await registrarLiquidacion(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onPaid()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Pagar nómina {formatPeriodo(nomina.periodo)}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="info-box">
            <strong className="info-box-title">Salarios · {formatPeriodo(nomina.periodo)}</strong>
            <span className="text-xs-muted">
              Total {formatMonto(nomina.total)} {nomina.moneda} · Pagado {formatMonto(nomina.pagado)} ·
              <strong> Pendiente {formatMonto(nomina.saldo_pendiente)} {nomina.moneda}</strong>
            </span>
          </div>
          {compat.length === 0 ? (
            <div className="alert alert-warning mt-3">No tienes cuentas en {nomina.moneda}. Crea una en Tesorería para registrar el pago.</div>
          ) : (
            <form onSubmit={handleSubmit} className="gc-liq-form">
              <div className="ter-form-grid">
                <div className="input-group ter-col-full">
                  <label>Cuenta <span className="required">*</span></label>
                  <select className="input" value={cuentaId} onChange={e => setCuentaId(e.target.value)} required>
                    {compat.map(c => <option key={c.cuenta_id} value={c.cuenta_id}>{c.nombre} · {c.moneda}</option>)}
                  </select>
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Monto ({nomina.moneda}) <span className="required">*</span></label>
                  <input className="input" name="monto" type="number" min="0" step="0.01" required defaultValue={nomina.saldo_pendiente.toFixed(2)} />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Fecha <span className="required">*</span></label>
                  <input className="input" name="fecha" type="date" required defaultValue={hoyISO()} />
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-sm mt-2" disabled={isPending}>
                {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : 'Registrar pago'}
              </button>
            </form>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
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
  const [pagar,            setPagar]            = useState<NominaConLineas | null>(null)

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
          onConfirmar={() => setConfirmarNom(detalleVivo)}
          onPagar={() => { setPagar(detalleVivo); setDetalleNominaId(null) }} />
      )}
      {confirmarNom && (
        <ConfirmarNominaModal nomina={confirmarNom} onConfirm={doConfirmarNomina}
          onClose={() => setConfirmarNom(null)} isPending={isPending} />
      )}
      {delNomina && (
        <ConfirmEliminarNomina nomina={delNomina} onConfirm={doEliminarNomina}
          onClose={() => setDelNomina(null)} isPending={isPending} />
      )}
      {pagar && (
        <PagarNominaModal nomina={pagar} cuentas={data.cuentas}
          onClose={() => setPagar(null)} onPaid={() => { setPagar(null); router.refresh() }} />
      )}
    </div>
  )
}
