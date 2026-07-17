'use client'

import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter }                         from 'next/navigation'
import Link                                  from 'next/link'
import { toastError, toastSuccess }          from '@/app/contexts/ToastContext'
import {
  archivarTercero,
  copiarTerceroAEmpresa,
  restaurarTercero,
  archivarTercerosEnLote,
  type Tercero,
  type TipoTercero,
  type TercerosPageData,
  type ResultadoLoteTerceros,
} from '@/app/actions/portal/terceros'
import { TerceroFormModal, ViaBadge }  from './_TerceroFormModal'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { RowActions }                  from '@/components/portal/RowActions'
import { ConfirmDialog }               from '@/components/portal/Dialog'
import BulkBar                         from '@/components/portal/BulkBar'
import { useRowSelection }             from '@/components/portal/useRowSelection'
import CopiarAEmpresaModal             from '@/components/portal/CopiarAEmpresaModal'
import { usePagination, TablePagination } from '@/components/TablePagination'
import PrerequisitoAviso                 from '@/components/portal/PrerequisitoAviso'
import EmpresaPills                    from '@/components/portal/EmpresaPills'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import { Archive, Copy, Eye, FileText, Mail, Pencil, Phone, Plus, RotateCcw, Search, Users, X } from 'lucide-react'

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
    <div className="modal-backdrop open">
      <div className="modal modal-440" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Archivar</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            ¿Archivar a <strong>{tercero.nombre}</strong>? No aparecerá en listas activas
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

// ── Vista principal ───────────────────────────────────────────────────────────

export default function TercerosView({ data }: { data: TercerosPageData }) {
  const router = useRouter()
  const { colorOf } = useEmpresas()
  const [isPending, startTransition] = useTransition()

  const [modalOpen,      setModalOpen]      = useState(false)
  const [editTercero,    setEditTercero]    = useState<Tercero | null>(null)
  const [confirmTercero, setConfirmTercero] = useState<Tercero | null>(null)
  const [copiarTercero,  setCopiarTercero]  = useState<Tercero | null>(null)

  const [search,        setSearch]        = useState('')
  const [filtroTipo,    setFiltroTipo]    = useState<'TODOS' | TipoTercero>('TODOS')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [verArchivados, setVerArchivados] = useState(false)

  const empresasLista = useMemo(
    () => data.empresas.map(e => ({ ...e, color: colorOf(e.empresa_id) })),
    [data.empresas, colorOf],
  )

  const multiempresa = empresasLista.length > 1

  const tercerosFiltrados = useMemo(() => {
    const q = search.toLowerCase().trim()
    return data.terceros.filter(t => {
      if (t.activo === verArchivados)                          return false
      if (filtroTipo !== 'TODOS' && t.tipo !== filtroTipo)     return false
      if (filtroEmpresa && t.empresa_id !== filtroEmpresa)     return false
      if (q) {
        const hay = [
          t.nombre, t.identificacion, t.representante, t.telefono, t.email, t.ciudad,
          t.moneda_defecto,
          t.via_primaria?.tipo,   t.via_primaria?.moneda,
          t.via_secundaria?.tipo, t.via_secundaria?.moneda,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data.terceros, search, filtroTipo, filtroEmpresa, verArchivados])

  const { pageItems, ...pag } = usePagination(tercerosFiltrados)

  // ── Selección múltiple (archivar/restaurar en lote) ──
  // La lista muestra activos XOR archivados, así que la acción es homogénea:
  // «Archivar» cuando se ven activos, «Restaurar» cuando se ven archivados.
  const idsVisibles = useMemo(() => tercerosFiltrados.map(t => t.tercero_id), [tercerosFiltrados])
  const sel = useRowSelection(idsVisibles)
  const [confirmLote, setConfirmLote] = useState(false)
  useEffect(() => { sel.clear() }, [verArchivados]) // eslint-disable-line react-hooks/exhaustive-deps
  const plural = (n: number) => n === 1 ? '' : 's'

  function ejecutarLote(fn: () => Promise<ResultadoLoteTerceros>, mensaje: (n: number) => string) {
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess(mensaje(r.hechas))
      sel.clear()
      router.refresh()
    })
  }
  function doArchivarLote() {
    setConfirmLote(false)
    ejecutarLote(() => archivarTercerosEnLote(sel.selectedIds, true), n => `${n} registro${plural(n)} archivado${plural(n)}.`)
  }

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
    <div className="view-container">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes y proveedores</h1>
          <p className="page-subtitle">Tus clientes, proveedores y contactos comerciales.</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate} disabled={empresasLista.length === 0}>
          <Plus size={14} strokeWidth={2.5} /> Nuevo cliente o proveedor
        </button>
      </div>

      {empresasLista.length === 0 && (
        <PrerequisitoAviso acciones={[{ label: 'Crear empresa', href: '/portal/empresas' }]}>
          Para registrar clientes y proveedores necesitas <strong>una empresa</strong>.
        </PrerequisitoAviso>
      )}

      {/* ── Toolbar ── */}
      <div className="ter-toolbar">
        <div className="ter-search-wrap">
          <Search size={16} strokeWidth={2} />
          <input
            type="search"
            className="ter-search"
            placeholder="Buscar por nombre, NIT, email, moneda, vía de pago…"
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
        <EmpresaPills
          empresas={empresasLista}
          value={filtroEmpresa}
          onChange={setFiltroEmpresa}
          todasLabel="Todas las empresas"
        />
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
            {verArchivados ? 'Archivados' : 'Activos'}
          </h2>
          <span className="text-xs-muted">
            {tercerosFiltrados.length} de {verArchivados ? archivados : activos}
          </span>
        </div>

        {tercerosFiltrados.length === 0 ? (
          <div className="mon-empty">
            <Users size={36} strokeWidth={1} opacity={0.25} />
            <p>
              {data.terceros.length === 0
                ? 'Aún no hay clientes ni proveedores. Crea el primero.'
                : 'No hay resultados para los filtros seleccionados.'}
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th className="col-check">
                    <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                  </th>
                  <th>Nombre / ID fiscal</th>
                  <th>Tipo</th>
                  {multiempresa && <th>Empresa</th>}
                  <th>Representante</th>
                  <th>Vías de pago</th>
                  <th>Cond. pago</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(t => (
                  <tr
                    key={t.tercero_id}
                    className={`table-row-clickable${!t.activo ? ' ter-row-archivada' : ''}${multiempresa ? ' row-empresa-accent' : ''}`}
                    style={multiempresa ? empresaColorVar(colorOf(t.empresa_id)) : undefined}
                    onClick={() => router.push(`/portal/terceros/${t.tercero_id}`)}
                  >

                    {/* Selección */}
                    <td className="col-check" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="row-check"
                        checked={sel.isSelected(t.tercero_id)}
                        onChange={() => sel.toggle(t.tercero_id)}
                        aria-label={`Seleccionar ${t.nombre}`} />
                    </td>

                    {/* Nombre / ID */}
                    <td data-label="Nombre">
                      <Link
                        href={`/portal/terceros/${t.tercero_id}`}
                        className="ter-nombre link-inherit"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t.nombre}
                      </Link>
                      {t.identificacion && <div className="ter-id-fiscal">{t.identificacion}</div>}
                    </td>

                    {/* Tipo */}
                    <td data-label="Tipo">
                      <span className={`ter-badge ${TIPO_CLS[t.tipo]}`}>
                        {TIPO_LABEL[t.tipo]}
                      </span>
                    </td>

                    {/* Empresa */}
                    {multiempresa && (
                      <td data-label="Empresa">
                        <EmpresaTag
                          color={colorOf(t.empresa_id)}
                          nombre={data.empresa_nombres[t.empresa_id] ?? t.empresa_id}
                        />
                      </td>
                    )}

                    {/* Representante */}
                    <td data-label="Representante">
                      <div className="ter-contacto">
                        {t.representante
                          ? <span className="ter-rep-nombre">{t.representante}
                              {t.cargo && <span className="ter-rep-cargo"> · {t.cargo}</span>}
                            </span>
                          : null}
                        {t.telefono && (
                          <span className="ter-contacto-item"><Phone size={11} strokeWidth={2} /> {t.telefono}</span>
                        )}
                        {t.email && (
                          <span className="ter-contacto-item"><Mail size={11} strokeWidth={2} /> {t.email}</span>
                        )}
                        {!t.representante && !t.telefono && !t.email && (
                          <span className="text-muted">—</span>
                        )}
                      </div>
                    </td>

                    {/* Vías de pago */}
                    <td data-label="Vías de pago">
                      <div className="ter-via-stack">
                        {t.via_primaria?.tipo || t.via_secundaria?.tipo
                          ? <>
                              <ViaBadge via={t.via_primaria} />
                              <ViaBadge via={t.via_secundaria} />
                            </>
                          : <span className="text-muted">—</span>}
                      </div>
                    </td>

                    {/* Condición pago */}
                    <td data-label="Cond. pago" className="ter-condicion">
                      {CONDICION_LABEL[t.condicion_pago] ?? t.condicion_pago}
                    </td>

                    {/* Acciones */}
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => router.push(`/portal/terceros/${t.tercero_id}`)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                        {t.contrato_url && (
                          <a
                            href={t.contrato_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="row-actions-item"
                          >
                            <FileText size={15} strokeWidth={2} /> Ver contrato
                          </a>
                        )}
                        {t.activo ? (
                          <>
                            <button className="row-actions-item" onClick={() => openEdit(t)}>
                              <Pencil size={15} strokeWidth={2} /> Editar
                            </button>
                            {multiempresa && (
                              <button className="row-actions-item" onClick={() => setCopiarTercero(t)}>
                                <Copy size={15} strokeWidth={2} /> Copiar a otra empresa
                              </button>
                            )}
                            <button className="row-actions-item row-actions-item-danger"
                              onClick={() => setConfirmTercero(t)} disabled={isPending}>
                              <Archive size={15} strokeWidth={2} /> Archivar
                            </button>
                          </>
                        ) : (
                          <button className="row-actions-item"
                            onClick={() => handleRestaurar(t)} disabled={isPending}>
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
        <TablePagination {...pag} label="registro" />
      </div>

      {/* ── Barra de acciones en lote ── */}
      <BulkBar count={sel.count} onClear={sel.clear}>
        {verArchivados ? (
          <button className="btn btn-secondary btn-sm" disabled={isPending}
            onClick={() => ejecutarLote(
              () => archivarTercerosEnLote(sel.selectedIds, false),
              n => `${n} registro${plural(n)} restaurado${plural(n)}.`)}>
            <RotateCcw size={14} strokeWidth={2} /> Restaurar
          </button>
        ) : (
          <button className="btn btn-danger-text btn-sm" disabled={isPending}
            onClick={() => setConfirmLote(true)}>
            <Archive size={14} strokeWidth={2} /> Archivar
          </button>
        )}
      </BulkBar>

      {/* ── Modales ── */}
      {modalOpen && (
        <TerceroFormModal
          tercero={editTercero}
          empresas={empresasLista}
          monedas={data.monedas}
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
      {confirmLote && (
        <ConfirmDialog
          title={`¿Archivar ${sel.count} registro${plural(sel.count)}?`}
          body="No aparecerán en las listas activas, pero podrás restaurarlos cuando quieras."
          confirmLabel="Archivar" danger
          onCancel={() => setConfirmLote(false)}
          onConfirm={doArchivarLote}
        />
      )}
      {copiarTercero && (
        <CopiarAEmpresaModal
          titulo="Copiar a otra empresa"
          descripcion="Se creará una ficha independiente en esa empresa, con sus propios saldos."
          empresas={empresasLista.filter(e => e.empresa_id !== copiarTercero.empresa_id)}
          monedas={data.monedas}
          monedaOrigen={copiarTercero.moneda_defecto}
          empresaOrigen={data.empresa_nombres[copiarTercero.empresa_id] ?? 'su empresa actual'}
          importe={copiarTercero.limite_credito
            ? { label: 'Límite de crédito', valor: copiarTercero.limite_credito, seConvierte: true }
            : undefined}
          tasas={data.tasas}
          onCopiar={(empresaId, moneda, limite) =>
            copiarTerceroAEmpresa(copiarTercero.tercero_id, empresaId, moneda, limite)}
          onClose={() => setCopiarTercero(null)}
          onCopiado={() => { setCopiarTercero(null); router.refresh() }}
        />
      )}
    </div>
  )
}

