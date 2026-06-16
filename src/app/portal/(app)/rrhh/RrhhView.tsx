'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
import { useRouter }                        from 'next/navigation'
import {
  guardarEmpleado,
  darBajaEmpleado,
  reactivarEmpleado,
  eliminarEmpleado,
  crearNomina,
  guardarLineaNomina,
  confirmarNomina,
  eliminarNomina,
  type Empleado,
  type EmpleadoConEstado,
  type TipoContrato,
  type Periodicidad,
  type NominaConLineas,
  type NominaLinea,
  type RrhhPageData,
} from '@/app/actions/portal/rrhh'
import { Check, CircleCheck, Pencil, Plus, RotateCcw, Trash2, UserMinus, Users, Search, Wallet, X } from 'lucide-react'

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPO_CONTRATO_LABEL: Record<TipoContrato, string> = {
  INDEFINIDO: 'Indefinido', TEMPORAL: 'Temporal', POR_OBRA: 'Por obra', PRACTICAS: 'Prácticas',
}
const PERIODICIDAD_LABEL: Record<Periodicidad, string> = {
  MENSUAL: 'Mensual', QUINCENAL: 'Quincenal', SEMANAL: 'Semanal', POR_HORA: 'Por hora',
}

const TIPOS_CONTRATO: TipoContrato[] = ['INDEFINIDO', 'TEMPORAL', 'POR_OBRA', 'PRACTICAS']
const PERIODICIDADES:  Periodicidad[] = ['MENSUAL', 'QUINCENAL', 'SEMANAL', 'POR_HORA']
const TURNOS_SUGERIDOS = ['Mañana', 'Tarde', 'Noche', 'Rotativo']

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function hoyISO(): string { return new Date().toISOString().split('T')[0] }
function formatFecha(f: string | null): string {
  if (!f) return '—'
  const [y, m, d] = f.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
function nombreCompleto(e: Empleado): string {
  return [e.nombre, e.apellidos].filter(Boolean).join(' ')
}
function formatPeriodo(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m) return periodo
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function mesActual(): string {
  return new Date().toISOString().slice(0, 7)
}

// ── Modal: crear / editar empleado ──────────────────────────────────────────────

function EmpleadoModal({
  empleado, data, onClose, onSaved,
}: {
  empleado: Empleado | null
  data:     RrhhPageData
  onClose:  () => void
  onSaved:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!empleado

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await guardarEmpleado(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar empleado' : 'Nuevo empleado'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {empleado && <input type="hidden" name="empleado_id" value={empleado.empleado_id} />}
          <div className="modal-body">
            <div className="ter-form-grid">

              <div className="input-group ter-col-span-3">
                <label>Nombre <span className="required">*</span></label>
                <input className="input" name="nombre" required autoFocus={!isEdit}
                  defaultValue={empleado?.nombre ?? ''} placeholder="Ej: Yusniel" />
              </div>
              <div className="input-group ter-col-span-3">
                <label>Apellidos</label>
                <input className="input" name="apellidos" defaultValue={empleado?.apellidos ?? ''} placeholder="Ej: Pérez Gómez" />
              </div>

              <div className="input-group ter-col-span-2">
                <label>Documento</label>
                <input className="input" name="documento" defaultValue={empleado?.documento ?? ''} placeholder="Carné de identidad" />
              </div>
              <div className="input-group ter-col-span-2">
                <label>Teléfono</label>
                <input className="input" name="telefono" defaultValue={empleado?.telefono ?? ''} placeholder="+53 5…" />
              </div>
              <div className="input-group ter-col-span-2">
                <label>Email</label>
                <input className="input" name="email" type="email" defaultValue={empleado?.email ?? ''} placeholder="correo@ejemplo.cu" />
              </div>

              <div className="input-group ter-col-span-2">
                <label>Empresa <span className="required">*</span></label>
                {data.empresas.length === 1 ? (
                  <>
                    <input className="input input-static" readOnly value={data.empresas[0].nombre} />
                    <input type="hidden" name="empresa_id" value={data.empresas[0].empresa_id} />
                  </>
                ) : (
                  <select className="input" name="empresa_id" defaultValue={empleado?.empresa_id ?? ''} required>
                    <option value="">Selecciona…</option>
                    {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
                  </select>
                )}
              </div>
              <div className="input-group ter-col-span-2">
                <label>Cargo</label>
                <input className="input" name="cargo" list="rrhh-cargos" defaultValue={empleado?.cargo ?? ''} placeholder="Cocinero, cajera…" />
                <datalist id="rrhh-cargos">{data.cargos.map(c => <option key={c} value={c} />)}</datalist>
              </div>
              <div className="input-group ter-col-span-2">
                <label>Departamento</label>
                <input className="input" name="departamento" list="rrhh-deptos" defaultValue={empleado?.departamento ?? ''} placeholder="Cocina, sala…" />
                <datalist id="rrhh-deptos">{data.departamentos.map(c => <option key={c} value={c} />)}</datalist>
              </div>

              <div className="input-group ter-col-span-2">
                <label>Tipo de contrato</label>
                <select className="input" name="tipo_contrato" defaultValue={empleado?.tipo_contrato ?? 'INDEFINIDO'}>
                  {TIPOS_CONTRATO.map(t => <option key={t} value={t}>{TIPO_CONTRATO_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="input-group ter-col-span-2">
                <label>Periodicidad de pago</label>
                <select className="input" name="periodicidad" defaultValue={empleado?.periodicidad ?? 'MENSUAL'}>
                  {PERIODICIDADES.map(p => <option key={p} value={p}>{PERIODICIDAD_LABEL[p]}</option>)}
                </select>
              </div>
              <div className="input-group ter-col-span-2">
                <label>Turno</label>
                <input className="input" name="turno" list="rrhh-turnos" defaultValue={empleado?.turno ?? ''} placeholder="Mañana, Rotativo…" />
                <datalist id="rrhh-turnos">
                  {Array.from(new Set([...TURNOS_SUGERIDOS, ...data.turnos])).map(c => <option key={c} value={c} />)}
                </datalist>
              </div>

              <div className="input-group ter-col-span-2">
                <label>Fecha de alta <span className="required">*</span></label>
                <input className="input" name="fecha_alta" type="date" required
                  defaultValue={empleado?.fecha_alta?.split('T')[0] ?? hoyISO()} />
              </div>
              <div className="input-group ter-col-span-2">
                <label>Salario base</label>
                <input className="input" name="salario_base" type="number" min="0" step="0.01"
                  defaultValue={empleado?.salario_base ?? ''} placeholder="0.00" />
              </div>
              <div className="input-group ter-col-span-2">
                <label>Moneda <span className="required">*</span></label>
                {isEdit ? (
                  <>
                    <input className="input input-static" readOnly value={empleado!.moneda} />
                    <span className="input-hint">La moneda no se cambia tras crear.</span>
                  </>
                ) : data.monedas.length === 0 ? (
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
                <label>Dirección</label>
                <input className="input" name="direccion" defaultValue={empleado?.direccion ?? ''} placeholder="Calle, número, municipio…" />
              </div>
              <div className="input-group ter-col-full">
                <label>Notas</label>
                <textarea className="input input-textarea" name="notas" rows={2}
                  defaultValue={empleado?.notas ?? ''} placeholder="Observaciones, condiciones especiales…" />
              </div>

            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || (!isEdit && data.monedas.length === 0)}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : isEdit ? 'Guardar cambios' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: dar de baja ───────────────────────────────────────────────────────────

function BajaModal({
  empleado, onClose, onSaved,
}: {
  empleado: EmpleadoConEstado
  onClose:  () => void
  onSaved:  () => void
}) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('empleado_id', empleado.empleado_id)
    startTransition(async () => {
      const res = await darBajaEmpleado(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Dar de baja</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="info-box">
              <strong className="info-box-title">{nombreCompleto(empleado)}</strong>
              <span className="text-xs-muted">{empleado.cargo ?? 'Sin cargo'}</span>
            </div>
            <div className="ter-form-grid">
              <div className="input-group ter-col-full">
                <label>Fecha de baja <span className="required">*</span></label>
                <input className="input" name="fecha_baja" type="date" required defaultValue={hoyISO()} />
              </div>
              <div className="input-group ter-col-full">
                <label>Motivo</label>
                <input className="input" name="motivo_baja" placeholder="Fin de contrato, renuncia…" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-danger" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Procesando…</> : 'Dar de baja'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Confirmación eliminar ───────────────────────────────────────────────────────

function ConfirmEliminar({
  empleado, onConfirm, onClose, isPending,
}: {
  empleado:  EmpleadoConEstado
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Eliminar empleado</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">¿Eliminar a <strong>{nombreCompleto(empleado)}</strong>? Esta acción no se puede deshacer. Si solo dejó de trabajar, usa <strong>dar de baja</strong> para conservar su historial.</p>
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
            <div className="mon-empty"><Users size={32} strokeWidth={1} opacity={0.2} /><p>Esta nómina no tiene líneas.</p></div>
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

// ── Vista principal ─────────────────────────────────────────────────────────────

export default function RrhhView({ data }: { data: RrhhPageData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [tab, setTab] = useState<'personal' | 'nomina'>('personal')

  const [modalEmpleado, setModalEmpleado] = useState(false)
  const [editEmpleado,  setEditEmpleado]  = useState<Empleado | null>(null)
  const [baja,          setBaja]          = useState<EmpleadoConEstado | null>(null)
  const [confirmDel,    setConfirmDel]    = useState<EmpleadoConEstado | null>(null)

  const [modalNuevaNomina, setModalNuevaNomina] = useState(false)
  const [detalleNominaId,  setDetalleNominaId]  = useState<string | null>(null)
  const [confirmarNom,     setConfirmarNom]     = useState<NominaConLineas | null>(null)
  const [delNomina,        setDelNomina]        = useState<NominaConLineas | null>(null)

  const [search,        setSearch]        = useState('')
  const [filtroEstado,  setFiltroEstado]  = useState('')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')

  const empleados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.empleados.filter(e => {
      if (filtroEstado  && e.estado     !== filtroEstado)  return false
      if (filtroEmpresa && e.empresa_id !== filtroEmpresa) return false
      if (q) {
        const hay = [e.nombre, e.apellidos, e.documento, e.cargo, e.departamento, e.email]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data.empleados, search, filtroEstado, filtroEmpresa])

  const activos = data.empleados.filter(e => e.estado === 'ACTIVO').length

  function openNuevo() { setEditEmpleado(null); setModalEmpleado(true) }
  function openEdit(e: Empleado) { setEditEmpleado(e); setModalEmpleado(true) }
  function onSaved() { setModalEmpleado(false); setEditEmpleado(null); setBaja(null); router.refresh() }

  function reactivar(empleado_id: string) {
    startTransition(async () => {
      const res = await reactivarEmpleado(empleado_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      router.refresh()
    })
  }

  function confirmarEliminar() {
    if (!confirmDel) return
    startTransition(async () => {
      const res = await eliminarEmpleado(confirmDel.empleado_id)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setConfirmDel(null); return }
      setConfirmDel(null); router.refresh()
    })
  }

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

      {/* Cabecera */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Personal y nómina</h1>
          <p className="page-subtitle">Empleados, contratos y bajas. {activos} {activos === 1 ? 'persona activa' : 'personas activas'}.</p>
        </div>
        <div className="tes-header-actions">
          {tab === 'personal' ? (
            <button className="btn btn-primary" onClick={openNuevo}><Plus size={14} strokeWidth={2.5} /> Nuevo empleado</button>
          ) : (
            <button className="btn btn-primary" onClick={() => setModalNuevaNomina(true)} disabled={data.empresas.length === 0}>
              <Plus size={14} strokeWidth={2.5} /> Nueva nómina
            </button>
          )}
        </div>
      </div>

      {/* Pestañas */}
      <div className="seg rrhh-tabs">
        <label className="seg-opt">
          <input type="radio" name="rrhh-tab" value="personal" checked={tab === 'personal'} onChange={() => setTab('personal')} />
          <span>Personal</span>
        </label>
        <label className="seg-opt">
          <input type="radio" name="rrhh-tab" value="nomina" checked={tab === 'nomina'} onChange={() => setTab('nomina')} />
          <span>Nómina</span>
        </label>
      </div>

      {tab === 'personal' ? (
        <>
          {/* Toolbar */}
          <div className="ter-toolbar">
            <div className="ter-search-wrap">
              <Search size={16} strokeWidth={2} />
              <input type="search" className="ter-search" placeholder="Buscar por nombre, documento, cargo…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="input ter-filter-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
              <option value="">Activos y bajas</option>
              <option value="ACTIVO">Solo activos</option>
              <option value="BAJA">Solo bajas</option>
            </select>
            {data.empresas.length > 1 && (
              <select className="input ter-filter-select" value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)}>
                <option value="">Todas las empresas</option>
                {data.empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
              </select>
            )}
          </div>

          {/* Tabla */}
          <div className="card card-table">
            {empleados.length === 0 ? (
              <div className="mon-empty">
                <Users size={40} strokeWidth={1} opacity={0.2} />
                <p>{data.empleados.length === 0
                  ? 'Aún no hay empleados. Da de alta al primero para gestionar tu personal y su nómina.'
                  : 'No hay empleados para los filtros seleccionados.'}</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Cargo</th>
                      <th>Contrato</th>
                      <th className="tes-col-monto">Salario base</th>
                      <th>Estado</th>
                      <th className="alm-col-act"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {empleados.map(e => (
                      <tr key={e.empleado_id}>
                        <td>
                          <strong>{nombreCompleto(e)}</strong>
                          <div className="tes-mov-sub">
                            {e.documento && <span className="tes-mov-cat">{e.documento}</span>}
                            {e.turno && <span className="badge badge-neutral tes-origen-badge">{e.turno}</span>}
                          </div>
                        </td>
                        <td>
                          {e.cargo ?? '—'}
                          {e.departamento && <div className="text-sm-muted">{e.departamento}</div>}
                        </td>
                        <td>
                          {TIPO_CONTRATO_LABEL[e.tipo_contrato]}
                          <div className="text-sm-muted">{PERIODICIDAD_LABEL[e.periodicidad]} · alta {formatFecha(e.fecha_alta)}</div>
                        </td>
                        <td className="tes-col-monto tes-monto-cell">
                          {e.salario_base > 0 ? `${formatMonto(e.salario_base)} ${e.moneda}` : '—'}
                        </td>
                        <td>
                          <span className={`badge ${e.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
                            {e.estado === 'ACTIVO' ? 'Activo' : 'Baja'}
                          </span>
                          {e.estado === 'BAJA' && e.fecha_baja && (
                            <div className="text-sm-muted">{formatFecha(e.fecha_baja)}</div>
                          )}
                        </td>
                        <td>
                          <div className="ter-actions">
                            <button className="ter-action-btn" title="Editar" onClick={() => openEdit(e)}><Pencil size={15} strokeWidth={2} /></button>
                            {e.estado === 'ACTIVO' ? (
                              <button className="ter-action-btn" title="Dar de baja" onClick={() => setBaja(e)}><UserMinus size={15} strokeWidth={2} /></button>
                            ) : (
                              <button className="ter-action-btn ter-action-restore" title="Reactivar"
                                onClick={() => reactivar(e.empleado_id)} disabled={isPending}><RotateCcw size={15} strokeWidth={2} /></button>
                            )}
                            <button className="ter-action-btn ter-action-danger" title="Eliminar"
                              onClick={() => setConfirmDel(e)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
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
      )}

      {/* Modales */}
      {modalEmpleado && (
        <EmpleadoModal empleado={editEmpleado} data={data}
          onClose={() => { setModalEmpleado(false); setEditEmpleado(null) }} onSaved={onSaved} />
      )}
      {baja && (
        <BajaModal empleado={baja} onClose={() => setBaja(null)} onSaved={onSaved} />
      )}
      {confirmDel && (
        <ConfirmEliminar empleado={confirmDel} onConfirm={confirmarEliminar}
          onClose={() => setConfirmDel(null)} isPending={isPending} />
      )}
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
