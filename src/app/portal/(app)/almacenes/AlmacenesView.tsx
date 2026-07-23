'use client'

import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
import { useRouter }                         from 'next/navigation'
import { Archive, Pencil, Plus, RotateCcw, Warehouse, X } from 'lucide-react'
import {
  guardarAlmacen,
  archivarAlmacen,
  restaurarAlmacen,
  type Almacen,
  type TipoAlmacen,
  type AlmacenesPageData,
} from '@/app/actions/portal/almacenes'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { RowActions }                  from '@/components/portal/RowActions'
import EmpresaPills                    from '@/components/portal/EmpresaPills'
import PrerequisitoAviso               from '@/components/portal/PrerequisitoAviso'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPOS: TipoAlmacen[] = ['FISICO', 'VIRTUAL', 'TRANSITO', 'CONSIGNACION']

const TIPO_ALMACEN_LABEL: Record<TipoAlmacen, string> = {
  FISICO:       'Físico',
  VIRTUAL:      'Virtual',
  TRANSITO:     'Tránsito',
  CONSIGNACION: 'Consignación',
}

const TIPO_ALMACEN_DESC: Record<TipoAlmacen, string> = {
  FISICO:       'Ubicación física real: nave, tienda, depósito',
  VIRTUAL:      'Stock asignado a una empresa sin ubicación física propia',
  TRANSITO:     'Mercancía en camino o entrega directa al cliente (drop-shipping)',
  CONSIGNACION: 'Mercancía de terceros en custodia — tratamiento fiscal diferente',
}

const TIPO_BADGE: Record<TipoAlmacen, string> = {
  FISICO:       'badge-info',
  VIRTUAL:      'badge-purple',
  TRANSITO:     'badge-warning',
  CONSIGNACION: 'badge-success',
}

// ── Modal de formulario ───────────────────────────────────────────────────────

function AlmacenModal({
  almacen, empresas, onClose, onSaved,
}: {
  almacen:  Almacen | null
  empresas: { empresa_id: string; nombre: string }[]
  onClose:  () => void
  onSaved:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [tipo,      setTipo]         = useState<TipoAlmacen>(almacen?.tipo ?? 'FISICO')

  const isEdit = !!almacen

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('tipo', tipo)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarAlmacen(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>

        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar almacén' : 'Nuevo almacén'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {almacen && <input type="hidden" name="almacen_id" value={almacen.almacen_id} />}

          <div className="modal-body">

            {/* ── Tipo ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Tipo de almacén</span>
              <div className="alm-tipo-grid">
                {TIPOS.map(t => (
                  <button key={t} type="button"
                    onClick={() => setTipo(t)}
                    className={`alm-tipo-btn${tipo === t ? ' active' : ''}`}>
                    <span className={`badge ${TIPO_BADGE[t]}`}>
                      {TIPO_ALMACEN_LABEL[t]}
                    </span>
                    <span className="text-xs-hint">
                      {TIPO_ALMACEN_DESC[t]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Datos ── */}
            <div className="ter-form-section mb-0">
              <span className="ter-form-section-title">Datos del almacén</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-4">
                  <label>Nombre <span className="required">*</span></label>
                  <input className="input" name="nombre" required autoFocus={!isEdit}
                    defaultValue={almacen?.nombre ?? ''}
                    placeholder="Ej: Almacén Central, Tienda Principal…" />
                </div>
                <div className="input-group ter-col-span-2">
                  <label>Empresa <span className="required">*</span></label>
                  {empresas.length === 1 ? (
                    <>
                      <input className="input input-static" readOnly value={empresas[0].nombre} />
                      <input type="hidden" name="empresa_id" value={empresas[0].empresa_id} />
                    </>
                  ) : (
                    <select className="input" name="empresa_id"
                      defaultValue={almacen?.empresa_id ?? ''} required>
                      <option value="">Selecciona una empresa…</option>
                      {empresas.map(e => (
                        <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="input-group ter-col-full">
                  <label>Descripción</label>
                  <textarea className="input input-textarea" name="descripcion" rows={2}
                    defaultValue={almacen?.descripcion ?? ''}
                    placeholder="Ubicación, características o notas del almacén…" />
                </div>
              </div>
            </div>

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios' : 'Crear almacén'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Confirmación archivar ─────────────────────────────────────────────────────

function ConfirmArchivar({
  almacen, onConfirm, onClose, isPending,
}: {
  almacen:   Almacen
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Archivar almacén</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            ¿Archivar <strong>{almacen.nombre}</strong>? No aparecerá en listas activas
            pero podrás restaurarlo cuando lo necesites.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={isPending}>
            {isPending
              ? <><span className="spinner spinner-sm" /> Archivando…</>
              : 'Archivar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function AlmacenesView({ data }: { data: AlmacenesPageData }) {
  const router = useRouter()
  const { colorOf } = useEmpresas()
  const multiempresa = data.empresas.length > 1
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))
  const [isPending, startTransition] = useTransition()

  const [modalOpen,   setModalOpen]   = useState(false)
  const [editAlmacen, setEditAlmacen] = useState<Almacen | null>(null)
  const [confirmAlm,  setConfirmAlm]  = useState<Almacen | null>(null)

  const [filtroEmpresa,  setFiltroEmpresa]  = useState('')
  const [filtroTipo,     setFiltroTipo]     = useState('')
  const [verArchivados,  setVerArchivados]  = useState(false)

  const almacenesFiltrados = useMemo(() => {
    return data.almacenes.filter(a => {
      if (a.activo === verArchivados)                        return false
      if (filtroEmpresa && a.empresa_id !== filtroEmpresa)   return false
      if (filtroTipo    && a.tipo       !== filtroTipo)       return false
      return true
    })
  }, [data.almacenes, filtroEmpresa, filtroTipo, verArchivados])

  const activos    = data.almacenes.filter(a =>  a.activo).length
  const archivados = data.almacenes.filter(a => !a.activo).length

  function openCreate()           { setEditAlmacen(null); setModalOpen(true) }
  function openEdit(a: Almacen)   { setEditAlmacen(a);   setModalOpen(true) }
  function closeModal()           { setModalOpen(false);  setEditAlmacen(null) }
  function onSaved()              { closeModal(); router.refresh() }

  function handleRestaurar(a: Almacen) {
    startTransition(async () => { await restaurarAlmacen(a.almacen_id); router.refresh() })
  }

  function confirmarArchivar() {
    if (!confirmAlm) return
    startTransition(async () => {
      await archivarAlmacen(confirmAlm.almacen_id)
      setConfirmAlm(null)
      router.refresh()
    })
  }

  // Resumen por tipo
  const conteoTipo = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of data.almacenes.filter(a => a.activo)) {
      m[a.tipo] = (m[a.tipo] ?? 0) + 1
    }
    return m
  }, [data.almacenes])

  return (
    <div className="view-container">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Almacenes</h1>
          <p className="page-subtitle">Ubicaciones físicas y virtuales donde se gestiona el inventario.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate} disabled={data.empresas.length === 0}>
          <Plus size={14} strokeWidth={2.5} /> Nuevo almacén
        </button>
      </div>

      {data.empresas.length === 0 && (
        <PrerequisitoAviso acciones={[{ label: 'Crear empresa', href: '/portal/empresas' }]}>
          Para crear almacenes necesitas <strong>una empresa</strong>.
        </PrerequisitoAviso>
      )}

      {/* ── Tarjetas resumen por tipo ── */}
      {activos > 0 && (
        <div className="alm-stats-grid">
          {TIPOS.map(t => (
            <div key={t} className="alm-stat-card">
              <div className="alm-stat-badge">
                <span className={`badge ${TIPO_BADGE[t]}`}>
                  {TIPO_ALMACEN_LABEL[t]}
                </span>
              </div>
              <div className="alm-stat-count">{conteoTipo[t] ?? 0}</div>
              <div className="alm-stat-label">almacén{(conteoTipo[t] ?? 0) !== 1 ? 'es' : ''}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="ter-toolbar">
        <EmpresaPills
          empresas={empresasFiltro}
          value={filtroEmpresa}
          onChange={setFiltroEmpresa}
          todasLabel="Todas las empresas"
        />
        <select className="input ter-filter-select" value={filtroTipo}
          onChange={e => setFiltroTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {TIPOS.map(t => (
            <option key={t} value={t}>{TIPO_ALMACEN_LABEL[t]}</option>
          ))}
        </select>
        <label className="ter-archivados-toggle">
          <input type="checkbox" checked={verArchivados}
            onChange={e => setVerArchivados(e.target.checked)} />
          <span>Archivados{archivados > 0 && ` (${archivados})`}</span>
        </label>
      </div>

      {/* ── Tabla ── */}
      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">
            {verArchivados ? 'Almacenes archivados' : 'Almacenes activos'}
          </h2>
          <span className="text-xs-muted">
            {almacenesFiltrados.length} de {verArchivados ? archivados : activos}
          </span>
        </div>

        {almacenesFiltrados.length === 0 ? (
          <div className="mon-empty">
            <Warehouse size={40} strokeWidth={1} opacity={0.2} />
            <p>
              {data.almacenes.length === 0
                ? 'Aún no hay almacenes registrados. Crea el primero para gestionar tu inventario.'
                : 'No hay resultados para los filtros seleccionados.'}
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  {multiempresa && <th>Empresa</th>}
                  <th>Tipo</th>
                  <th>Descripción</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {almacenesFiltrados.map(a => (
                  <tr
                    key={a.almacen_id}
                    className={`${!a.activo ? 'ter-row-archivada' : ''}${multiempresa ? ' row-empresa-accent' : ''}`}
                    style={multiempresa ? empresaColorVar(colorOf(a.empresa_id)) : undefined}
                  >

                    <td data-label="Nombre">
                      <strong>{a.nombre}</strong>
                      <div className="alm-id-text">{a.almacen_id}</div>
                    </td>

                    {multiempresa && (
                      <td data-label="Empresa">
                        <EmpresaTag color={colorOf(a.empresa_id)} nombre={data.empresa_nombres[a.empresa_id] ?? a.empresa_id} />
                      </td>
                    )}

                    <td data-label="Tipo">
                      <span className={`badge ${TIPO_BADGE[a.tipo]}`}>
                        {TIPO_ALMACEN_LABEL[a.tipo]}
                      </span>
                    </td>

                    <td data-label="Descripción" className="alm-desc-td cell-truncate">
                      {a.descripcion ?? '—'}
                    </td>

                    <td data-label="Estado">
                      <span className={`badge ${a.activo ? 'badge-success' : 'badge-neutral'}`}>
                        {a.activo ? 'Activo' : 'Archivado'}
                      </span>
                    </td>

                    <td className="col-actions">
                      <RowActions>
                        {a.activo ? (
                          <>
                            <button className="row-actions-item" onClick={() => openEdit(a)}>
                              <Pencil size={15} strokeWidth={2} /> Editar
                            </button>
                            <button className="row-actions-item row-actions-item-danger"
                              onClick={() => setConfirmAlm(a)} disabled={isPending}>
                              <Archive size={15} strokeWidth={2} /> Archivar
                            </button>
                          </>
                        ) : (
                          <button className="row-actions-item"
                            onClick={() => handleRestaurar(a)} disabled={isPending}>
                            <RotateCcw size={15} strokeWidth={2} /> Restaurar
                          </button>
                        )}
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modales ── */}
      {modalOpen && (
        <AlmacenModal
          almacen={editAlmacen}
          empresas={data.empresas}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}
      {confirmAlm && (
        <ConfirmArchivar
          almacen={confirmAlm}
          onConfirm={confirmarArchivar}
          onClose={() => setConfirmAlm(null)}
          isPending={isPending}
        />
      )}
    </div>
  )
}

