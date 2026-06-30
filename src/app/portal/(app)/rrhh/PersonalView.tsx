'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
import { useRouter }                        from 'next/navigation'
import {
  guardarEmpleado,
  darBajaEmpleado,
  reactivarEmpleado,
  eliminarEmpleado,
  type Empleado,
  type EmpleadoConEstado,
  type TipoContrato,
  type Periodicidad,
  type RrhhPageData,
} from '@/app/actions/portal/rrhh'
import { Pencil, Plus, RotateCcw, Trash2, UserMinus, Users, Search, X } from 'lucide-react'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import EmpresaPills                    from '@/components/portal/EmpresaPills'

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPO_CONTRATO_LABEL: Record<TipoContrato, string> = {
  INDEFINIDO: 'Indefinido', TEMPORAL: 'Temporal', POR_OBRA: 'Por obra', PRACTICAS: 'Prácticas',
}
const PERIODICIDAD_LABEL: Record<Periodicidad, string> = {
  MENSUAL: 'Mensual', QUINCENAL: 'Quincenal', SEMANAL: 'Semanal', POR_HORA: 'Por hora',
}
const TIPOS_CONTRATO: TipoContrato[]  = ['INDEFINIDO', 'TEMPORAL', 'POR_OBRA', 'PRACTICAS']
const PERIODICIDADES:  Periodicidad[] = ['MENSUAL', 'QUINCENAL', 'SEMANAL', 'POR_HORA']

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

// ── Modal: crear / editar empleado ──────────────────────────────────────────────

export function EmpleadoModal({
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

export function BajaModal({
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

export function ConfirmEliminar({
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

// ── Página: Personal ─────────────────────────────────────────────────────────────

export default function PersonalView({ data }: { data: RrhhPageData }) {
  const router = useRouter()
  const { colorOf } = useEmpresas()
  const multiempresa = data.empresas.length > 1
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))
  const [isPending, startTransition] = useTransition()

  const [modalEmpleado, setModalEmpleado] = useState(false)
  const [editEmpleado,  setEditEmpleado]  = useState<Empleado | null>(null)
  const [baja,          setBaja]          = useState<EmpleadoConEstado | null>(null)
  const [confirmDel,    setConfirmDel]    = useState<EmpleadoConEstado | null>(null)

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

  return (
    <div className="view-container">

      <div className="page-header">
        <div>
          <h1 className="page-title">Personal</h1>
          <p className="page-subtitle">Empleados, contratos y bajas. {activos} {activos === 1 ? 'persona activa' : 'personas activas'}.</p>
        </div>
        <div className="tes-header-actions">
          <button className="btn btn-primary" onClick={openNuevo}><Plus size={14} strokeWidth={2.5} /> Nuevo empleado</button>
        </div>
      </div>

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
        <EmpresaPills
          empresas={empresasFiltro}
          value={filtroEmpresa}
          onChange={setFiltroEmpresa}
          todasLabel="Todas las empresas"
        />
      </div>

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
                  {multiempresa && <th>Empresa</th>}
                  <th>Cargo</th>
                  <th>Contrato</th>
                  <th className="tes-col-monto">Salario base</th>
                  <th>Estado</th>
                  <th className="alm-col-act"></th>
                </tr>
              </thead>
              <tbody>
                {empleados.map(e => (
                  <tr key={e.empleado_id}
                    className={`table-row-clickable${multiempresa ? ' row-empresa-accent' : ''}`}
                    style={multiempresa ? empresaColorVar(colorOf(e.empresa_id)) : undefined}
                    onClick={() => router.push(`/portal/rrhh/${e.empleado_id}`)}>
                    <td>
                      <strong>{nombreCompleto(e)}</strong>
                      <div className="tes-mov-sub">
                        {e.documento && <span className="tes-mov-cat">{e.documento}</span>}
                      </div>
                    </td>
                    {multiempresa && (
                      <td>
                        <EmpresaTag color={colorOf(e.empresa_id)} nombre={data.empresa_nombres[e.empresa_id] ?? '—'} />
                      </td>
                    )}
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
                      <div className="ter-actions" onClick={ev => ev.stopPropagation()}>
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
    </div>
  )
}
