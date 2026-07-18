'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter }                        from 'next/navigation'
import {
  guardarEmpleado,
  darBajaEmpleado,
  reactivarEmpleado,
  eliminarEmpleado,
  copiarEmpleadoAEmpresa,
  darBajaEmpleadosEnLote,
  reactivarEmpleadosEnLote,
  eliminarEmpleadosEnLote,
  type Empleado,
  type EmpleadoConEstado,
  type TipoContrato,
  type Periodicidad,
  type RrhhPageData,
  type ResultadoLote,
} from '@/app/actions/portal/rrhh'
import { Copy, Eye, Info, Pencil, Plus, RotateCcw, Trash2, UserMinus, Users, Search, X } from 'lucide-react'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { RowActions }                  from '@/components/portal/RowActions'
import BulkBar                         from '@/components/portal/BulkBar'
import { useRowSelection }             from '@/components/portal/useRowSelection'
import { ConfirmDialog }               from '@/components/portal/Dialog'
import CopiarAEmpresaModal             from '@/components/portal/CopiarAEmpresaModal'
import { opcionesCon }                 from '@/components/portal/form-helpers'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import EmpresaPills                    from '@/components/portal/EmpresaPills'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso                 from '@/components/portal/PrerequisitoAviso'
import IaTouchpoint                    from '@/components/portal/ia/IaTouchpoint'

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

  // La moneda es editable también al editar: hay que poder corregir la de un
  // empleado copiado a una empresa que opera en otra moneda.
  const [moneda,  setMoneda]  = useState(empleado?.moneda ?? '')
  // El salario se guarda como texto para no pelear con el input: un estado
  // numérico impide teclear "0" o dejarlo vacío mientras se escribe.
  const [salario, setSalario] = useState(empleado?.salario_base?.toString() ?? '')

  const monedaOrigen  = empleado?.moneda ?? ''
  const salarioOrigen = empleado?.salario_base ?? 0
  const cambiaMoneda  = isEdit && !!moneda && moneda !== monedaOrigen
  const factor        = cambiaMoneda ? data.tasas[`${monedaOrigen}__${moneda}`] : undefined

  // Cambiar la moneda vacía el salario: en otra moneda es otro salario y lo pone
  // el dueño — un trabajador que cobra 65.000 CUP en una empresa puede cobrar
  // 300 USD de extra en otra, no los 98 que daría la tasa. La conversión se
  // ofrece como atajo (aplicarTasa), no se impone: un importe inventado pero
  // plausible se guarda sin mirar, y un campo vacío se ve. Volver a la moneda
  // original restaura su salario tal cual.
  function handleMoneda(nueva: string) {
    setMoneda(nueva)
    if (!isEdit) return
    setSalario(nueva === monedaOrigen ? salarioOrigen.toString() : '')
  }
  function aplicarTasa() {
    if (factor) setSalario((salarioOrigen * factor).toFixed(2))
  }

  // Empresa del empleado (o la única, al crear): su moneda funcional es la
  // referencia para detectar una ficha que quedó en la moneda de otra empresa.
  const empresa       = data.empresas.find(e => e.empresa_id === (empleado?.empresa_id ?? data.empresas[0]?.empresa_id))
  const monedaEmpresa = empresa?.moneda_funcional ?? null
  const nombreEmpresa = empresa?.nombre ?? 'Esta empresa'

  // La moneda que ya tiene el empleado se ofrece aunque esté desactivada: si no,
  // desactivar una moneda dejaría sus fichas sin poder guardarse.
  const opcionesMoneda = opcionesCon(data.monedas.map(m => m.codigo), empleado?.moneda)

  // Nóminas donde ya aparece: conservan su moneda pase lo que pase (cada nómina
  // guarda la suya y sus líneas son un snapshot), pero conviene avisar.
  const nominasEmpleado = empleado
    ? data.nominas.filter(n => n.lineas.some(l => l.empleado_id === empleado.empleado_id))
    : []
  const nominasBorrador = nominasEmpleado.filter(n => n.estado === 'BORRADOR').length

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
                <label htmlFor="emp-salario">Salario base</label>
                <input className="input" id="emp-salario" name="salario_base" type="number" min="0" step="0.01"
                  value={salario} onChange={e => setSalario(e.target.value)}
                  placeholder="0.00" />
              </div>
              <div className="input-group ter-col-span-2">
                <label htmlFor="emp-moneda">Moneda <span className="required">*</span></label>
                {opcionesMoneda.length === 0 ? (
                  <>
                    <input className="input input-static" readOnly value="Sin monedas activas" />
                    <span className="input-hint">Crea una moneda en Monedas y Tasas primero.</span>
                  </>
                ) : (
                  <>
                    <select className="input" id="emp-moneda" name="moneda" required
                      value={moneda} onChange={e => handleMoneda(e.target.value)}>
                      <option value="" disabled>Selecciona…</option>
                      {opcionesMoneda.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <span className="input-hint">
                      {monedaEmpresa && monedaEmpresa !== moneda
                        ? `${nombreEmpresa} opera en ${monedaEmpresa}.`
                        : 'En la que cobra esta persona.'}
                    </span>
                  </>
                )}
              </div>

              {cambiaMoneda && (
                <div className="rrhh-moneda-cambio">
                  {salarioOrigen > 0 && (
                    <div className="rrhh-moneda-nota">
                      <Info size={14} strokeWidth={2} />
                      <span>
                        Antes cobraba {formatMonto(salarioOrigen)} {monedaOrigen}. Escribe su salario en {moneda}
                        {factor && <> o <button type="button" className="aplicar-tasa-btn" onClick={aplicarTasa}>
                          usa la tasa ({formatMonto(salarioOrigen * factor)} {moneda})</button></>}.
                      </span>
                    </div>
                  )}
                  {nominasEmpleado.length > 0 && (
                    <div className="rrhh-moneda-nota">
                      <Info size={14} strokeWidth={2} />
                      <span>
                        Aparece en {nominasEmpleado.length} nómina{nominasEmpleado.length !== 1 ? 's' : ''} en {monedaOrigen}:
                        se conservan tal cual y las nuevas se harán en {moneda}.
                        {nominasBorrador > 0 && ` Revisa ${nominasBorrador === 1 ? 'la que está en borrador' : `las ${nominasBorrador} en borrador`}.`}
                      </span>
                    </div>
                  )}
                </div>
              )}

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
  const [copiarEmpleado, setCopiarEmpleado] = useState<EmpleadoConEstado | null>(null)

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

  const { pageItems, ...pag } = usePagination(empleados)

  // ── Selección múltiple (baja / reactivar / eliminar en lote) ──
  const empleadoIds = useMemo(() => empleados.map(e => e.empleado_id), [empleados])
  const sel = useRowSelection(empleadoIds)
  const [bajaLote,     setBajaLote]     = useState(false)
  const [confirmLoteDel, setConfirmLoteDel] = useState(false)
  useEffect(() => { sel.clear() }, [search, filtroEstado, filtroEmpresa]) // eslint-disable-line react-hooks/exhaustive-deps
  const plural = (n: number) => n === 1 ? '' : 's'
  const seleccionados = empleados.filter(e => sel.isSelected(e.empleado_id))
  const hayActivos = seleccionados.some(e => e.estado === 'ACTIVO')
  const hayBajas   = seleccionados.some(e => e.estado === 'BAJA')

  function ejecutarLote(fn: () => Promise<ResultadoLote>) {
    startTransition(async () => {
      const r = await fn()
      if (r.error) { toastError(r.error); return }
      const partes: string[] = []
      if (r.hechas)          partes.push(`${r.hechas} aplicado${plural(r.hechas)}`)
      if (r.omitidas.length) partes.push(`${r.omitidas.length} omitido${plural(r.omitidas.length)}`)
      if (r.errores.length)  partes.push(`${r.errores.length} con error`)
      const msg = partes.join(' · ') || 'Nada que hacer'
      if (r.hechas > 0 && r.errores.length === 0) toastSuccess(msg)
      else if (r.hechas > 0)                      toastError(msg)
      else                                        toastError(r.omitidas[0]?.motivo ? `Nada aplicado — ${r.omitidas[0].motivo}` : msg)
      sel.clear()
      router.refresh()
    })
  }
  function doBajaLote(fecha: string, motivo: string) {
    setBajaLote(false)
    ejecutarLote(() => darBajaEmpleadosEnLote(sel.selectedIds, fecha, motivo))
  }
  function doEliminarLote() { setConfirmLoteDel(false); ejecutarLote(() => eliminarEmpleadosEnLote(sel.selectedIds)) }

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
          <div className="page-title-ia">
            <h1 className="page-title">Personal</h1>
            <IaTouchpoint tipo="rrhh" descripcion="un análisis de tu personal" />
          </div>
          <p className="page-subtitle">Empleados, contratos y bajas. {activos} {activos === 1 ? 'persona activa' : 'personas activas'}.</p>
        </div>
        <div className="tes-header-actions">
          <button className="btn btn-primary" onClick={openNuevo} disabled={data.empresas.length === 0 || data.monedas.length === 0}><Plus size={14} strokeWidth={2.5} /> Nuevo empleado</button>
        </div>
      </div>

      {(data.empresas.length === 0 || data.monedas.length === 0) && (
        <PrerequisitoAviso acciones={data.empresas.length === 0
          ? [{ label: 'Crear empresa', href: '/portal/empresas' }]
          : [{ label: 'Crear moneda', href: '/portal/monedas' }]}>
          {data.empresas.length === 0
            ? <>Para dar de alta personal necesitas <strong>una empresa</strong>.</>
            : <>Para dar de alta personal necesitas <strong>al menos una moneda</strong> configurada.</>}
        </PrerequisitoAviso>
      )}

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
                  <th className="col-check">
                    <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                  </th>
                  <th>Empleado</th>
                  {multiempresa && <th>Empresa</th>}
                  <th>Cargo</th>
                  <th>Contrato</th>
                  <th className="col-num">Salario base</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(e => (
                  <tr key={e.empleado_id}
                    className={`table-row-clickable${multiempresa ? ' row-empresa-accent' : ''}`}
                    style={multiempresa ? empresaColorVar(colorOf(e.empresa_id)) : undefined}
                    onClick={() => router.push(`/portal/rrhh/${e.empleado_id}`)}>
                    <td className="col-check" onClick={ev => ev.stopPropagation()}>
                      <input type="checkbox" className="row-check"
                        checked={sel.isSelected(e.empleado_id)}
                        onChange={() => sel.toggle(e.empleado_id)}
                        aria-label={`Seleccionar ${nombreCompleto(e)}`} />
                    </td>
                    <td data-label="Empleado">
                      <strong>{nombreCompleto(e)}</strong>
                      <div className="tes-mov-sub">
                        {e.documento && <span className="tes-mov-cat">{e.documento}</span>}
                      </div>
                    </td>
                    {multiempresa && (
                      <td data-label="Empresa">
                        <EmpresaTag color={colorOf(e.empresa_id)} nombre={data.empresa_nombres[e.empresa_id] ?? '—'} />
                      </td>
                    )}
                    <td data-label="Cargo">
                      {e.cargo ?? '—'}
                      {e.departamento && <div className="text-sm-muted">{e.departamento}</div>}
                    </td>
                    <td data-label="Contrato">
                      {TIPO_CONTRATO_LABEL[e.tipo_contrato]}
                      <div className="text-sm-muted">{PERIODICIDAD_LABEL[e.periodicidad]} · alta {formatFecha(e.fecha_alta)}</div>
                    </td>
                    <td data-label="Salario base" className="col-num tes-monto-cell">
                      {e.salario_base > 0 ? `${formatMonto(e.salario_base)} ${e.moneda}` : '—'}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge ${e.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
                        {e.estado === 'ACTIVO' ? 'Activo' : 'Baja'}
                      </span>
                      {e.estado === 'BAJA' && e.fecha_baja && (
                        <div className="text-sm-muted">{formatFecha(e.fecha_baja)}</div>
                      )}
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => router.push(`/portal/rrhh/${e.empleado_id}`)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                        <button className="row-actions-item" onClick={() => openEdit(e)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                        {multiempresa && e.estado === 'ACTIVO' && (
                          <button className="row-actions-item" onClick={() => setCopiarEmpleado(e)}><Copy size={15} strokeWidth={2} /> Copiar a otra empresa</button>
                        )}
                        {e.estado === 'ACTIVO' ? (
                          <button className="row-actions-item" onClick={() => setBaja(e)}><UserMinus size={15} strokeWidth={2} /> Dar de baja</button>
                        ) : (
                          <button className="row-actions-item"
                            onClick={() => reactivar(e.empleado_id)} disabled={isPending}><RotateCcw size={15} strokeWidth={2} /> Reactivar</button>
                        )}
                        <button className="row-actions-item row-actions-item-danger"
                          onClick={() => setConfirmDel(e)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="empleado" />
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
      {copiarEmpleado && (
        <CopiarAEmpresaModal
          titulo="Copiar a otra empresa"
          descripcion="Se creará un empleado independiente en esa empresa, con su propio contrato."
          empresas={data.empresas.filter(x => x.empresa_id !== copiarEmpleado.empresa_id)}
          monedas={data.monedas}
          monedaOrigen={copiarEmpleado.moneda}
          empresaOrigen={data.empresa_nombres[copiarEmpleado.empresa_id] ?? 'su empresa actual'}
          importe={{ label: 'Salario base', valor: copiarEmpleado.salario_base, seConvierte: false }}
          tasas={data.tasas}
          onCopiar={(empresaId, moneda, salario) =>
            copiarEmpleadoAEmpresa(copiarEmpleado.empleado_id, empresaId, moneda, salario)}
          onClose={() => setCopiarEmpleado(null)}
          onCopiado={() => { setCopiarEmpleado(null); router.refresh() }}
        />
      )}

      <BulkBar count={sel.count} onClear={sel.clear}>
        {hayActivos && (
          <button className="btn btn-secondary btn-sm" disabled={isPending}
            onClick={() => setBajaLote(true)}>
            <UserMinus size={14} strokeWidth={2} /> Dar de baja
          </button>
        )}
        {hayBajas && (
          <button className="btn btn-secondary btn-sm" disabled={isPending}
            onClick={() => ejecutarLote(() => reactivarEmpleadosEnLote(sel.selectedIds))}>
            <RotateCcw size={14} strokeWidth={2} /> Reactivar
          </button>
        )}
        <button className="btn btn-danger-text btn-sm" disabled={isPending}
          onClick={() => setConfirmLoteDel(true)}>
          <Trash2 size={14} strokeWidth={2} /> Eliminar
        </button>
      </BulkBar>

      {bajaLote && (
        <BajaLoteModal count={sel.count} onClose={() => setBajaLote(false)} onConfirm={doBajaLote} />
      )}
      {confirmLoteDel && (
        <ConfirmDialog
          title={`¿Eliminar ${sel.count} empleado${plural(sel.count)}?`}
          body="Se eliminarán los seleccionados. Los que aparezcan en nóminas registradas se omitirán (da de baja en su lugar para conservar el historial)."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmLoteDel(false)}
          onConfirm={doEliminarLote}
        />
      )}
    </div>
  )
}

// ── Modal: dar de baja en lote (fecha + motivo comunes) ───────────────────────────

function BajaLoteModal({ count, onClose, onConfirm }: {
  count: number; onClose: () => void; onConfirm: (fecha: string, motivo: string) => void
}) {
  const [fecha, setFecha]   = useState(new Date().toISOString().slice(0, 10))
  const [motivo, setMotivo] = useState('')
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Dar de baja {count} empleado{count === 1 ? '' : 's'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="input-group">
            <label htmlFor="baja-lote-fecha">Fecha de baja <span className="required">*</span></label>
            <input id="baja-lote-fecha" className="input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div className="input-group">
            <label htmlFor="baja-lote-motivo">Motivo (opcional)</label>
            <textarea id="baja-lote-motivo" className="input input-textarea" rows={2}
              value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder="Común a todos los seleccionados…" />
          </div>
          <p className="input-hint">La fecha y el motivo se aplican a todos los seleccionados. Los que ya estén de baja se omiten.</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={!fecha}
            onClick={() => onConfirm(fecha, motivo)}>Dar de baja</button>
        </div>
      </div>
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
