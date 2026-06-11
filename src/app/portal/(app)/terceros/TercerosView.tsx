'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter }                         from 'next/navigation'
import Link                                  from 'next/link'
import {
  archivarTercero,
  restaurarTercero,
  type Tercero,
  type TipoTercero,
  type ViaPago,
  type TercerosPageData,
} from '@/app/actions/portal/terceros'
import { TerceroFormModal, VIA_BADGE } from './_TerceroFormModal'

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPO_LABEL: Record<TipoTercero, string> = {
  CLIENTE:   'Cliente',
  PROVEEDOR: 'Proveedor',
  AMBOS:     'Ambos',
}
const TIPO_CLS: Record<TipoTercero, string> = {
  CLIENTE:   'ter-badge-cliente',
  PROVEEDOR: 'ter-badge-proveedor',
  AMBOS:     'ter-badge-ambos',
}

const CONDICION_LABEL: Record<string, string> = {
  CONTADO: 'Contado',
  '15': '15 días', '30': '30 días', '60': '60 días', '90': '90 días',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ViaBadge({ via }: { via: ViaPago | null }) {
  if (!via?.tipo) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
  const info = VIA_BADGE[via.tipo]
  if (!info) return <span className="via-badge">{via.tipo}</span>
  return (
    <span className={`via-badge ${info.cls}`} title={via.tipo}>
      {info.label}
    </span>
  )
}

// ── Confirmación archivar ─────────────────────────────────────────────────────

function ConfirmArchivar({
  tercero, onConfirm, onClose, isPending,
}: {
  tercero:   Tercero
  onConfirm: () => void
  onClose:   () => void
  isPending: boolean
}) {
  return (
    <div className="modal-backdrop open" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Archivar tercero</h2>
          <button type="button" className="modal-close" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            ¿Archivar a <strong>{tercero.nombre}</strong>? No aparecerá en listas activas
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

export default function TercerosView({ data }: { data: TercerosPageData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [modalOpen,      setModalOpen]      = useState(false)
  const [editTercero,    setEditTercero]    = useState<Tercero | null>(null)
  const [confirmTercero, setConfirmTercero] = useState<Tercero | null>(null)

  const [search,        setSearch]        = useState('')
  const [filtroTipo,    setFiltroTipo]    = useState<'TODOS' | TipoTercero>('TODOS')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [verArchivados, setVerArchivados] = useState(false)

  const empresasLista = useMemo(() => {
    const seen = new Set<string>()
    return Object.entries(data.empresa_nombres)
      .filter(([id]) => { if (seen.has(id)) return false; seen.add(id); return true })
      .map(([empresa_id, nombre]) => ({ empresa_id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [data.empresa_nombres])

  const tercerosFiltrados = useMemo(() => {
    const q = search.toLowerCase().trim()
    return data.terceros.filter(t => {
      if (t.activo === verArchivados)                          return false
      if (filtroTipo !== 'TODOS' && t.tipo !== filtroTipo)     return false
      if (filtroEmpresa && t.empresa_id !== filtroEmpresa)     return false
      if (q) {
        const hay = [
          t.nombre, t.identificacion, t.representante, t.telefono, t.email, t.ciudad,
          t.via_primaria?.tipo, t.via_secundaria?.tipo,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data.terceros, search, filtroTipo, filtroEmpresa, verArchivados])

  function openCreate() { setEditTercero(null); setModalOpen(true) }
  function openEdit(t: Tercero) { setEditTercero(t); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditTercero(null) }
  function onSaved() { closeModal(); router.refresh() }

  function handleRestaurar(t: Tercero) {
    startTransition(async () => { await restaurarTercero(t.tercero_id); router.refresh() })
  }
  function confirmArchivarFn() {
    if (!confirmTercero) return
    startTransition(async () => {
      await archivarTercero(confirmTercero.tercero_id)
      setConfirmTercero(null)
      router.refresh()
    })
  }

  const activos    = data.terceros.filter(t =>  t.activo).length
  const archivados = data.terceros.filter(t => !t.activo).length

  return (
    <div className="view-container" style={{ maxWidth: 1100 }}>

      {/* ── Cabecera ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Terceros</h1>
          <p className="page-subtitle">Clientes, proveedores y contactos comerciales.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <IconPlus /> Nuevo tercero
        </button>
      </div>

      {/* ── Toolbar ── */}
      <div className="ter-toolbar">
        <div className="ter-search-wrap">
          <IconSearch />
          <input
            type="search"
            className="ter-search"
            placeholder="Buscar por nombre, RIF, email, vía de pago…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="input ter-filter-select" value={filtroTipo}
          onChange={e => setFiltroTipo(e.target.value as typeof filtroTipo)}>
          <option value="TODOS">Todos los tipos</option>
          <option value="CLIENTE">Clientes</option>
          <option value="PROVEEDOR">Proveedores</option>
          <option value="AMBOS">Ambos</option>
        </select>
        {empresasLista.length > 1 && (
          <select className="input ter-filter-select" value={filtroEmpresa}
            onChange={e => setFiltroEmpresa(e.target.value)}>
            <option value="">Todas las empresas</option>
            {empresasLista.map(e => (
              <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>
            ))}
          </select>
        )}
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
            {verArchivados ? 'Archivados' : 'Terceros activos'}
          </h2>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {tercerosFiltrados.length} de {verArchivados ? archivados : activos}
          </span>
        </div>

        {tercerosFiltrados.length === 0 ? (
          <div className="mon-empty">
            <IconUsers />
            <p>
              {data.terceros.length === 0
                ? 'Aún no hay terceros registrados. Crea el primero.'
                : 'No hay resultados para los filtros seleccionados.'}
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre / ID fiscal</th>
                  <th>Tipo</th>
                  {empresasLista.length > 1 && <th>Empresa</th>}
                  <th>Representante</th>
                  <th>Vías de pago</th>
                  <th>Cond. pago</th>
                  <th style={{ width: 96 }}></th>
                </tr>
              </thead>
              <tbody>
                {tercerosFiltrados.map(t => (
                  <tr key={t.tercero_id} className={!t.activo ? 'ter-row-archivada' : ''}>

                    {/* Nombre / ID */}
                    <td>
                      <Link
                        href={`/portal/terceros/${t.tercero_id}`}
                        className="ter-nombre"
                        style={{ textDecoration: 'none', color: 'inherit' }}
                      >
                        {t.nombre}
                      </Link>
                      {t.identificacion && <div className="ter-id-fiscal">{t.identificacion}</div>}
                    </td>

                    {/* Tipo */}
                    <td>
                      <span className={`ter-badge ${TIPO_CLS[t.tipo]}`}>
                        {TIPO_LABEL[t.tipo]}
                      </span>
                    </td>

                    {/* Empresa */}
                    {empresasLista.length > 1 && (
                      <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                        {data.empresa_nombres[t.empresa_id] ?? t.empresa_id}
                      </td>
                    )}

                    {/* Representante */}
                    <td>
                      <div className="ter-contacto">
                        {t.representante
                          ? <span className="ter-rep-nombre">{t.representante}
                              {t.cargo && <span className="ter-rep-cargo"> · {t.cargo}</span>}
                            </span>
                          : null}
                        {t.telefono && (
                          <span className="ter-contacto-item"><IconPhone /> {t.telefono}</span>
                        )}
                        {t.email && (
                          <span className="ter-contacto-item"><IconMail /> {t.email}</span>
                        )}
                        {!t.representante && !t.telefono && !t.email && (
                          <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                        )}
                      </div>
                    </td>

                    {/* Vías de pago */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <ViaBadge via={t.via_primaria} />
                        {t.via_secundaria?.tipo && <ViaBadge via={t.via_secundaria} />}
                      </div>
                    </td>

                    {/* Condición pago */}
                    <td style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>
                      {CONDICION_LABEL[t.condicion_pago] ?? t.condicion_pago}
                    </td>

                    {/* Acciones */}
                    <td>
                      <div className="ter-actions">
                        {/* Contrato */}
                        {t.contrato_url && (
                          <a
                            href={t.contrato_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ter-action-btn"
                            title="Ver contrato"
                            style={{ textDecoration: 'none' }}
                          >
                            <IconFileLink />
                          </a>
                        )}
                        {t.activo ? (
                          <>
                            <button className="ter-action-btn" title="Editar"
                              onClick={() => openEdit(t)}>
                              <IconEdit />
                            </button>
                            <button className="ter-action-btn ter-action-danger" title="Archivar"
                              onClick={() => setConfirmTercero(t)} disabled={isPending}>
                              <IconArchive />
                            </button>
                          </>
                        ) : (
                          <button className="ter-action-btn ter-action-restore" title="Restaurar"
                            onClick={() => handleRestaurar(t)} disabled={isPending}>
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

      {/* ── Modales ── */}
      {modalOpen && (
        <TerceroFormModal
          tercero={editTercero}
          empresas={empresasLista}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}
      {confirmTercero && (
        <ConfirmArchivar
          tercero={confirmTercero}
          onConfirm={confirmArchivarFn}
          onClose={() => setConfirmTercero(null)}
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
function IconSearch() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
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
function IconUsers() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="36" height="36" style={{ opacity: 0.25 }}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
}
function IconPhone() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12 19.79 19.79 0 011.61 3.37 2 2 0 013.6 1.21h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 8.77a16 16 0 006.29 6.29l1.63-1.63a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
}
function IconMail() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
}
function IconFileLink() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
}
