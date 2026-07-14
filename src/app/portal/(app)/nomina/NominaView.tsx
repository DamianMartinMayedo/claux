'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter }               from 'next/navigation'
import {
  crearNomina,
  confirmarNomina,
  eliminarNomina,
  type NominaConLineas,
  type RrhhPageData,
} from '@/app/actions/portal/rrhh'
import { Eye, Plus, Trash2, Wallet, X } from 'lucide-react'
import {
  NominaDetalleModal,
  ConfirmarNominaModal,
  PagarNominaModal,
  formatMonto,
  hoyISO,
  formatPeriodo,
} from '../_shared/NominaDetalleModal'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { RowActions }                  from '@/components/portal/RowActions'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso                 from '@/components/portal/PrerequisitoAviso'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import EmpresaPills                    from '@/components/portal/EmpresaPills'

function mesActual(): string {
  return new Date().toISOString().slice(0, 7)
}
function siguienteMes(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  const d = new Date(y, m, 1)
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

export default function NominaView({ data, focusNominaId }: { data: RrhhPageData; focusNominaId?: string }) {
  const router = useRouter()
  const { colorOf } = useEmpresas()
  const multiempresa = data.empresas.length > 1
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))
  const [isPending, startTransition] = useTransition()

  const [modalNuevaNomina, setModalNuevaNomina] = useState(false)
  const [detalleNominaId,  setDetalleNominaId]  = useState<string | null>(null)
  const [confirmarNom,     setConfirmarNom]     = useState<NominaConLineas | null>(null)
  const [delNomina,        setDelNomina]        = useState<NominaConLineas | null>(null)
  const [pagar,            setPagar]            = useState<NominaConLineas | null>(null)

  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [filtroAnio,    setFiltroAnio]    = useState('')

  const aniosDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const n of data.nominas) if (n.periodo) set.add(n.periodo.slice(0, 4))
    return Array.from(set).sort().reverse()
  }, [data.nominas])

  const nominasFiltradas = useMemo(() => {
    return data.nominas.filter(n => {
      if (filtroEmpresa && n.empresa_id !== filtroEmpresa) return false
      if (filtroAnio && !n.periodo.startsWith(filtroAnio))  return false
      return true
    })
  }, [data.nominas, filtroEmpresa, filtroAnio])

  const { pageItems, ...pag } = usePagination(nominasFiltradas)

  useEffect(() => {
    if (focusNominaId && data.nominas.some(n => n.nomina_id === focusNominaId)) {
      setDetalleNominaId(focusNominaId)
    }
  }, [focusNominaId, data.nominas])

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

      {data.empresas.length === 0 && (
        <PrerequisitoAviso acciones={[{ label: 'Crear empresa', href: '/portal/empresas' }]}>
          Para crear una nómina necesitas <strong>una empresa</strong>.
        </PrerequisitoAviso>
      )}

      <div className="ter-toolbar">
        <EmpresaPills
          empresas={empresasFiltro}
          value={filtroEmpresa}
          onChange={setFiltroEmpresa}
          todasLabel="Todas las empresas"
        />
        {aniosDisponibles.length > 1 && (
          <select className="input ter-filter-select" value={filtroAnio} onChange={e => setFiltroAnio(e.target.value)}>
            <option value="">Todos los años</option>
            {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
      </div>

      <div className="card card-table">
        {nominasFiltradas.length === 0 ? (
          <div className="mon-empty">
            <Wallet size={40} strokeWidth={1} opacity={0.2} />
            <p>{data.nominas.length === 0
              ? 'Aún no hay nóminas. Crea la primera para pagar a tus personal activo; al confirmarla se registra como gasto de salarios en tu contabilidad.'
              : 'No hay nóminas para los filtros seleccionados.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Período</th>
                  {multiempresa && <th>Empresa</th>}
                  <th>Empleados</th>
                  <th className="col-num">Total</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(n => (
                  <tr
                    key={n.nomina_id}
                    className={`table-row-clickable${multiempresa ? ' row-empresa-accent' : ''}`}
                    style={multiempresa ? empresaColorVar(colorOf(n.empresa_id)) : undefined}
                    onClick={() => setDetalleNominaId(n.nomina_id)}
                  >
                    <td data-label="Período"><strong>{formatPeriodo(n.periodo)}</strong></td>
                    {multiempresa && (
                      <td data-label="Empresa">
                        <EmpresaTag color={colorOf(n.empresa_id)} nombre={data.empresa_nombres[n.empresa_id] ?? '—'} />
                      </td>
                    )}
                    <td data-label="Empleados" className="text-sm-muted">{n.lineas.length}</td>
                    <td data-label="Total" className="col-num tes-monto-cell">{formatMonto(n.total)} {n.moneda}</td>
                    <td data-label="Estado">
                      <span className={`badge ${n.estado === 'BORRADOR' ? 'badge-warning' : (n.saldo_pendiente <= 0.005 ? 'badge-success' : 'badge-info')}`}>
                        {n.estado === 'BORRADOR' ? 'Borrador' : (n.saldo_pendiente <= 0.005 ? 'Pagada' : 'Pendiente de pago')}
                      </span>
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => setDetalleNominaId(n.nomina_id)}><Eye size={15} strokeWidth={2} /> Ver detalle</button>
                        <button className="row-actions-item row-actions-item-danger"
                          onClick={() => setDelNomina(n)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="nómina" />
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
