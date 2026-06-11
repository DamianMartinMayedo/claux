'use client'

import { useState, useTransition, useMemo } from 'react'
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

const TIPO_STYLE: Record<TipoAlmacen, { bg: string; color: string }> = {
  FISICO:       { bg: '#dbeafe', color: '#1d4ed8' },
  VIRTUAL:      { bg: '#f3e8ff', color: '#7c3aed' },
  TRANSITO:     { bg: '#fef3c7', color: '#92400e' },
  CONSIGNACION: { bg: '#dcfce7', color: '#166534' },
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
  const [error,     setError]        = useState('')
  const [tipo,      setTipo]         = useState<TipoAlmacen>(almacen?.tipo ?? 'FISICO')

  const isEdit = !!almacen

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    fd.set('tipo', tipo)
    startTransition(async () => {
      const res = await guardarAlmacen(fd)
      if (!res.ok) { setError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {TIPOS.map(t => (
                  <button key={t} type="button"
                    onClick={() => setTipo(t)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                      gap: 4, padding: '12px 14px', textAlign: 'left',
                      border: `2px solid ${tipo === t ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      borderRadius: 'var(--radius-lg)',
                      background: tipo === t ? '#e0f5f4' : 'var(--color-surface)',
                      cursor: 'pointer',
                    }}>
                    <span style={{
                      fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.05em', padding: '2px 8px', borderRadius: '999px',
                      background: TIPO_STYLE[t].bg, color: TIPO_STYLE[t].color,
                    }}>
                      {TIPO_ALMACEN_LABEL[t]}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                      {TIPO_ALMACEN_DESC[t]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Datos ── */}
            <div className="ter-form-section" style={{ marginBottom: 0 }}>
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
                      <input className="input" readOnly value={empresas[0].nombre}
                        style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }} />
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

            {error && <div className="alert alert-error" style={{ marginTop: 16 }}>{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} /> Guardando…</>
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
    <div className="modal-backdrop open" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Archivar almacén</h2>
          <button type="button" className="modal-close" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            ¿Archivar <strong>{almacen.nombre}</strong>? No aparecerá en listas activas
            pero podrás restaurarlo cuando lo necesites.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={isPending}>
            {isPending
              ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} /> Archivando…</>
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
    <div className="view-container" style={{ maxWidth: 1000 }}>

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {TIPOS.map(t => (
            <div key={t} style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: '14px 16px',
            }}>
              <div style={{ marginBottom: 6 }}>
                <span style={{
                  fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', padding: '2px 8px', borderRadius: '999px',
                  background: TIPO_STYLE[t].bg, color: TIPO_STYLE[t].color,
                }}>
                  {TIPO_ALMACEN_LABEL[t]}
                </span>
              </div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-text)' }}>
                {conteoTipo[t] ?? 0}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                almacén{(conteoTipo[t] ?? 0) !== 1 ? 'es' : ''}
              </div>
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
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
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
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {almacenesFiltrados.map(a => (
                  <tr key={a.almacen_id} className={!a.activo ? 'ter-row-archivada' : ''}>

                    <td>
                      <strong style={{ fontSize: 'var(--text-sm)' }}>{a.nombre}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'monospace', marginTop: 1 }}>
                        {a.almacen_id}
                      </div>
                    </td>

                    {data.empresas.length > 1 && (
                      <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                        {data.empresa_nombres[a.empresa_id] ?? a.empresa_id}
                      </td>
                    )}

                    <td>
                      <span style={{
                        display: 'inline-block',
                        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.04em', padding: '2px 8px', borderRadius: '999px',
                        background: TIPO_STYLE[a.tipo].bg, color: TIPO_STYLE[a.tipo].color,
                      }}>
                        {TIPO_ALMACEN_LABEL[a.tipo]}
                      </span>
                    </td>

                    <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', maxWidth: 280 }}>
                      {a.descripcion ?? '—'}
                    </td>

                    <td>
                      <span style={{
                        display: 'inline-block',
                        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.04em', padding: '2px 8px', borderRadius: '999px',
                        background: a.activo ? '#dcfce7' : '#f1f5f9',
                        color:      a.activo ? '#16a34a' : '#64748b',
                      }}>
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
      <div style={{
        marginTop: 16, padding: '12px 16px', borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
        fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--color-text-secondary)' }}>Nota:</strong> Los movimientos de inventario
        (entradas, salidas, ajustes y transferencias entre almacenes) se gestionan en el módulo{' '}
        <strong style={{ color: 'var(--color-text-secondary)' }}>Inventario</strong> dentro de Gestión.
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
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" style={{ opacity: 0.2 }}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
}
