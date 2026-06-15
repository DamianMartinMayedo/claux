'use client'

'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
import { useToast } from '@/app/contexts/ToastContext'
import { useRouter }                         from 'next/navigation'
import {
  guardarAlmacen,
  archivarAlmacen,
  restaurarAlmacen,
  type Almacen,
  type TipoAlmacen,
  type AlmacenesPageData,
} from '@/app/actions/portal/almacenes'

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
    startTransition(async () => {
      const res = await guardarAlmacen(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>

        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar almacén' : 'Nuevo almacén'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><IconX /></button>
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
          <button type="button" className="modal-close" onClick={onClose}><IconX /></button>
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
        <button className="btn btn-primary" onClick={openCreate}>
          <IconPlus /> Nuevo almacén
        </button>
      </div>

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
        {data.empresas.length > 1 && (
          <select className="input ter-filter-select" value={filtroEmpresa}
            onChange={e => setFiltroEmpresa(e.target.value)}>
            <option value="">Todas las empresas</option>
            {data.empresas.map(e => (
              <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>
            ))}
          </select>
        )}
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
            <IconAlmacenLg />
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
                  {data.empresas.length > 1 && <th>Empresa</th>}
                  <th>Tipo</th>
                  <th>Descripción</th>
                  <th>Estado</th>
                  <th className="alm-col-act"></th>
                </tr>
              </thead>
              <tbody>
                {almacenesFiltrados.map(a => (
                  <tr key={a.almacen_id} className={!a.activo ? 'ter-row-archivada' : ''}>

                    <td>
                      <strong>{a.nombre}</strong>
                      <div className="alm-id-text">{a.almacen_id}</div>
                    </td>

                    {data.empresas.length > 1 && (
                      <td className="text-sm-muted">
                        {data.empresa_nombres[a.empresa_id] ?? a.empresa_id}
                      </td>
                    )}

                    <td>
                      <span className={`badge ${TIPO_BADGE[a.tipo]}`}>
                        {TIPO_ALMACEN_LABEL[a.tipo]}
                      </span>
                    </td>

                    <td className="alm-desc-td">
                      {a.descripcion ?? '—'}
                    </td>

                    <td>
                      <span className={`badge ${a.activo ? 'badge-success' : 'badge-neutral'}`}>
                        {a.activo ? 'Activo' : 'Archivado'}
                      </span>
                    </td>

                    <td>
                      <div className="ter-actions">
                        {a.activo ? (
                          <>
                            <button className="ter-action-btn" title="Editar"
                              onClick={() => openEdit(a)}>
                              <IconEdit />
                            </button>
                            <button className="ter-action-btn ter-action-danger" title="Archivar"
                              onClick={() => setConfirmAlm(a)} disabled={isPending}>
                              <IconArchive />
                            </button>
                          </>
                        ) : (
                          <button className="ter-action-btn ter-action-restore" title="Restaurar"
                            onClick={() => handleRestaurar(a)} disabled={isPending}>
                            <IconRestore />
                          </button>
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

      {/* ── Nota informativa ── */}
      <div className="alm-nota-info">
        <strong className="text-muted">Nota:</strong> Los movimientos de inventario
        (entradas, salidas, ajustes y transferencias entre almacenes) se gestionan en el módulo{' '}
        <strong className="text-muted">Inventario</strong> dentro de Gestión.
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

// ── Iconos ────────────────────────────────────────────────────────────────────

function IconPlus() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function IconX() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
}
function IconEdit() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
}
function IconArchive() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
}
function IconRestore() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
}
function IconAlmacenLg() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" opacity="0.2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
}
