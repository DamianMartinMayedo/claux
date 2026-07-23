'use client'

import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import { ConfirmDialog } from '@/components/portal/Dialog'
import BulkBar from '@/components/portal/BulkBar'
import { useRowSelection } from '@/components/portal/useRowSelection'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useState, useTransition, useMemo, useEffect } from 'react'
import { useRouter }                         from 'next/navigation'
import Link                                  from 'next/link'
import {
  archivarProducto,
  restaurarProducto,
  eliminarProducto,
  archivarProductosEnLote,
  eliminarProductosEnLote,
  guardarCategoria,
  archivarCategoria,
  restaurarCategoria,
  type Producto,
  type Categoria,
  type TipoCategoria,
  type TipoProducto,
  type ProductosPageData,
  type ResultadoLoteProductos,
} from '@/app/actions/portal/productos'
import { ProductoFormModal } from './_ProductoFormModal'
import { StockAjusteModal } from './_StockAjusteModal'
import { AlertTriangle, Archive, Eye, Layers, Package, Pencil, Plus, RotateCcw, Search, Tag, Trash2, X } from 'lucide-react'
import Tabs from '@/components/Tabs'

const TIPO_CATEGORIA_LABEL: Record<TipoCategoria, string> = {
  PRODUCTO: 'Productos físicos', SERVICIO: 'Servicios', AMBAS: 'Ambos',
}

// ── CategoriaModal ────────────────────────────────────────────────────────────

function CategoriaModal({ categoria, modo, onClose, onSaved }: {
  categoria: Categoria | null; modo: TipoProducto; onClose: () => void; onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!categoria
  // Al crear desde Servicios, la categoría nace de servicios; desde Inventario, de
  // productos. Es lo que va a querer el 90 % de las veces, y se puede cambiar.
  const [tipo, setTipo] = useState<TipoCategoria>(categoria?.tipo ?? modo)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarCategoria(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar categoría' : 'Nueva categoría'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          {categoria && <input type="hidden" name="categoria_id" value={categoria.categoria_id} />}
          <div className="modal-body">
            <div className="input-group">
              <label>Nombre <span className="required">*</span></label>
              <input className="input" name="nombre" required autoFocus
                defaultValue={categoria?.nombre ?? ''} placeholder="Ej: Electrónicos, Servicios profesionales…" />
            </div>
            <div className="input-group">
              <label htmlFor="cat-tipo">Se usa en <span className="required">*</span></label>
              <select className="input" id="cat-tipo" name="tipo" value={tipo}
                onChange={e => setTipo(e.target.value as TipoCategoria)}>
                <option value="PRODUCTO">Solo productos físicos</option>
                <option value="SERVICIO">Solo servicios</option>
                <option value="AMBAS">Productos y servicios</option>
              </select>
              <span className="input-hint">Dónde aparece al crear un artículo.</span>
            </div>
            <div className="input-group">
              <label>Descripción</label>
              <textarea className="input input-textarea" name="descripcion" rows={2}
                defaultValue={categoria?.descripcion ?? ''} placeholder="Descripción opcional…" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios' : 'Crear categoría'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── ConfirmArchivar ───────────────────────────────────────────────────────────

function ConfirmArchivar({ nombre, onConfirm, onClose, isPending }: {
  nombre: string; onConfirm: () => void; onClose: () => void; isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Archivar</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            ¿Archivar <strong>{nombre}</strong>? No aparecerá en listas activas,
            pero podrás restaurarlo cuando lo necesites.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Archivando…</> : 'Archivar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ConfirmEliminar ───────────────────────────────────────────────────────────

function ConfirmEliminar({ nombre, onConfirm, onClose, isPending }: {
  nombre: string; onConfirm: () => void; onClose: () => void; isPending: boolean
}) {
  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Eliminar definitivamente</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-body-text">
            ¿Eliminar <strong>{nombre}</strong> para siempre? Esta acción no se puede deshacer.
            Solo es posible si no tiene ventas, compras, movimientos ni está en tu catálogo.
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

export default function ProductosView({ data }: { data: ProductosPageData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Inventario y Servicios comparten esta vista pero cada uno cataloga UN tipo
  // (data.modo) sobre su propia página. La etiqueta del servicio la pone el sector
  // (Servicio / Tratamiento / Clase…), nunca el código.
  const esProducto   = data.modo === 'PRODUCTO'
  const basePath     = esProducto ? '/portal/productos' : '/portal/servicios'
  const sustantivo   = esProducto ? 'producto' : data.etiquetaServicio.toLowerCase()
  const tituloPagina = esProducto ? 'Productos' : `${data.etiquetaServicio}s`

  const [tab,           setTab]          = useState<'productos' | 'categorias'>('productos')
  const [productoModal, setProductoModal] = useState(false)
  const [editProducto,  setEditProducto]  = useState<Producto | null>(null)
  const [stockProducto, setStockProducto] = useState<Producto | null>(null)
  const [confirmProd,   setConfirmProd]   = useState<Producto | null>(null)
  const [eliminarProd,  setEliminarProd]  = useState<Producto | null>(null)
  const [search,        setSearch]        = useState('')
  const [filtroCat,     setFiltroCat]     = useState('')
  const [filtroProv,    setFiltroProv]    = useState('')
  const [verArchivados, setVerArchivados] = useState(false)

  const [catModal,   setCatModal]   = useState(false)
  const [editCat,    setEditCat]    = useState<Categoria | null>(null)
  const [confirmCat, setConfirmCat] = useState<Categoria | null>(null)

  const categoriaMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of data.categorias) m[c.categoria_id] = c.nombre
    return m
  }, [data.categorias])

  const productosPorCategoria = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of data.productos) {
      if (p.estado !== 'ACTIVO') continue
      const key = p.categoria_id ?? '__sin_categoria__'
      m[key] = (m[key] ?? 0) + 1
    }
    return m
  }, [data.productos])

  const sinCategoriaCount = productosPorCategoria['__sin_categoria__'] ?? 0

  const productosFiltrados = useMemo(() => {
    const q = search.toLowerCase().trim()
    return data.productos.filter(p => {
      if ((p.estado === 'ACTIVO') === verArchivados)       return false
      if (filtroCat === '__sin_categoria__') {
        if (p.categoria_id) return false
      } else if (filtroCat && p.categoria_id !== filtroCat) return false
      if (filtroProv && p.proveedor_id !== filtroProv)     return false
      if (q) {
        const hay = [
          p.nombre, p.codigo, p.codigo_proveedor, p.descripcion, p.unidad,
          p.categoria_id ? categoriaMap[p.categoria_id] : null,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data.productos, search, filtroCat, filtroProv, verArchivados, categoriaMap])

  const { pageItems: prodItems, ...prodPag } = usePagination(productosFiltrados)
  const { pageItems: catItems, ...catPag } = usePagination(data.categorias)

  // ── Selección múltiple (archivar/restaurar/eliminar en lote) ──
  const idsVisibles = useMemo(() => productosFiltrados.map(p => p.producto_id), [productosFiltrados])
  const sel = useRowSelection(idsVisibles)
  const [confirmLote, setConfirmLote] = useState<'archivar' | 'eliminar' | null>(null)
  useEffect(() => { sel.clear() }, [verArchivados, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const plural = (n: number) => n === 1 ? '' : 's'

  function ejecutarLote(fn: () => Promise<ResultadoLoteProductos>, exito: (n: number) => string, cargando: string) {
    const ld = toastLoading(cargando)
    startTransition(async () => {
      const r = await fn()
      await ld.dismiss()
      if (r.error) { toastError(r.error); return }
      const partes: string[] = []
      if (r.hechas)          partes.push(exito(r.hechas))
      if (r.omitidas.length) partes.push(`${r.omitidas.length} omitido${plural(r.omitidas.length)}`)
      if (r.hechas > 0)      toastSuccess(partes.join(' · '))
      else                   toastError(r.omitidas[0]?.motivo ? `No se aplicó a ninguno — ${r.omitidas[0].motivo}` : 'Nada que hacer')
      sel.clear()
      router.refresh()
    })
  }
  function doArchivarLote() {
    setConfirmLote(null)
    ejecutarLote(() => archivarProductosEnLote(sel.selectedIds, true), n => `${n} ${sustantivo}${plural(n)} archivado${plural(n)}`, 'Archivando…')
  }
  function doEliminarLote() {
    setConfirmLote(null)
    ejecutarLote(() => eliminarProductosEnLote(sel.selectedIds), n => `${n} ${sustantivo}${plural(n)} eliminado${plural(n)}`, 'Eliminando…')
  }

  const activos           = data.productos.filter(p => p.estado === 'ACTIVO').length
  const archivados        = data.productos.filter(p => p.estado === 'INACTIVO').length
  const categoriasActivas = data.categorias.filter(c => c.estado === 'ACTIVO')

  function openCreate()           { setEditProducto(null); setProductoModal(true) }
  function openEdit(p: Producto)  { setEditProducto(p);    setProductoModal(true) }
  function closeModal()           { setProductoModal(false); setEditProducto(null) }
  function onSaved()              { closeModal(); router.refresh() }
  function onStockSaved()         { setStockProducto(null); router.refresh() }

  function handleRestaurar(p: Producto) {
    startTransition(async () => { await restaurarProducto(p.producto_id); router.refresh() })
  }
  function confirmarArchivar() {
    if (!confirmProd) return
    startTransition(async () => {
      await archivarProducto(confirmProd.producto_id)
      setConfirmProd(null); router.refresh()
    })
  }
  function confirmarEliminar() {
    if (!eliminarProd) return
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarProducto(eliminarProd.producto_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'No se pudo eliminar.'); return }
      toastSuccess(`${sustantivo.charAt(0).toUpperCase()}${sustantivo.slice(1)} eliminado.`)
      setEliminarProd(null); router.refresh()
    })
  }

  function openCreateCat()          { setEditCat(null); setCatModal(true) }
  function openEditCat(c: Categoria) { setEditCat(c);   setCatModal(true) }
  function closeCatModal()          { setCatModal(false); setEditCat(null) }
  function onCatSaved()             { closeCatModal(); router.refresh() }

  function handleRestaurarCat(c: Categoria) {
    startTransition(async () => { await restaurarCategoria(c.categoria_id); router.refresh() })
  }
  function confirmarArchivarCat() {
    if (!confirmCat) return
    startTransition(async () => {
      await archivarCategoria(confirmCat.categoria_id)
      setConfirmCat(null); router.refresh()
    })
  }

  return (
    <div className="view-container">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{tituloPagina}</h1>
          <p className="page-subtitle">
            {esProducto
              ? 'Tus productos físicos, con su precio y existencias.'
              : 'Tus servicios y su precio. Se cargan solos en ofertas y facturas.'}
          </p>
        </div>
        {tab === 'productos'
          ? <button className="btn btn-primary" onClick={openCreate}><Plus size={14} strokeWidth={2.5} /> Nuevo</button>
          : <button className="btn btn-primary" onClick={openCreateCat}><Plus size={14} strokeWidth={2.5} /> Nueva categoría</button>
        }
      </div>

      {/* ── Tabs ── */}
      <Tabs
        ariaLabel={`Secciones de ${tituloPagina.toLowerCase()}`}
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'productos',  label: tituloPagina,   count: activos },
          { id: 'categorias', label: 'Categorías',   count: categoriasActivas.length },
        ]}
      />

      {/* ══ TAB PRODUCTOS ══ */}
      {tab === 'productos' && (
        <>
          {/* Toolbar */}
          <div className="ter-toolbar">
            <div className="ter-search-wrap">
              <Search size={16} strokeWidth={2} />
              <input type="search" className="ter-search"
                placeholder="Buscar por nombre, código, categoría…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {(categoriasActivas.length > 0 || sinCategoriaCount > 0) && (
              <select className="input ter-filter-select" value={filtroCat}
                onChange={e => setFiltroCat(e.target.value)}>
                <option value="">Todas las categorías</option>
                {categoriasActivas.map(c => (
                  <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>
                ))}
                {sinCategoriaCount > 0 && (
                  <option value="__sin_categoria__">Sin categoría ({sinCategoriaCount})</option>
                )}
              </select>
            )}
            {data.proveedores.length > 0 && (
              <select className="input ter-filter-select" value={filtroProv}
                onChange={e => setFiltroProv(e.target.value)}>
                <option value="">Todos los proveedores</option>
                {data.proveedores.map(p => (
                  <option key={p.tercero_id} value={p.tercero_id}>{p.nombre}</option>
                ))}
              </select>
            )}
            <label className="ter-archivados-toggle">
              <input type="checkbox" checked={verArchivados}
                onChange={e => setVerArchivados(e.target.checked)} />
              <span>Archivados{archivados > 0 && ` (${archivados})`}</span>
            </label>
          </div>

          {/* Tabla */}
          <div className="card card-table">
            <div className="mon-card-header">
              <h2 className="mon-section-title">{verArchivados ? 'Archivados' : 'Catálogo activo'}</h2>
              <span className="card-count">
                {productosFiltrados.length} de {verArchivados ? archivados : activos}
              </span>
            </div>

            {productosFiltrados.length === 0 ? (
              <div className="mon-empty">
                <Package size={36} strokeWidth={1} opacity={0.25} />
                <p>{data.productos.length === 0
                  ? `Aún no hay ${tituloPagina.toLowerCase()} en el catálogo. Crea el primero.`
                  : 'No hay resultados para los filtros seleccionados.'}</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="col-check">
                        <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                      </th>
                      <th>Nombre</th>
                      <th>Código</th>
                      <th>Categoría</th>
                      <th>Precios de venta</th>
                      {esProducto && <th>Stock</th>}
                      <th className="col-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {prodItems.map(p => {
                      const stockBajo = p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo
                      return (
                        <tr
                          key={p.producto_id}
                          className={`table-row-clickable${p.estado === 'INACTIVO' ? ' ter-row-archivada' : ''}`}
                          onClick={() => router.push(`${basePath}/${p.producto_id}`)}
                        >
                          {/* Selección */}
                          <td className="col-check" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" className="row-check"
                              checked={sel.isSelected(p.producto_id)}
                              onChange={() => sel.toggle(p.producto_id)}
                              aria-label={`Seleccionar ${p.nombre}`} />
                          </td>
                          {/* Nombre */}
                          <td data-label="Nombre">
                            <Link
                              href={`${basePath}/${p.producto_id}`}
                              className="table-name-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {p.nombre}
                            </Link>
                            {p.descripcion && (
                              <div className="table-cell-sub">{p.descripcion}</div>
                            )}
                          </td>

                          {/* Código */}
                          <td data-label="Código">
                            <span className="code-value">{p.codigo}</span>
                            {p.codigo_proveedor && (
                              <div className="table-cell-secondary">{p.codigo_proveedor}</div>
                            )}
                          </td>

                          {/* Categoría */}
                          <td data-label="Categoría" className="text-sm-muted">
                            {p.categoria_id ? (categoriaMap[p.categoria_id] ?? '—') : '—'}
                          </td>

                          {/* Precios */}
                          <td data-label="Precios de venta">
                            <div className="prd-precios-cell">
                              {Object.entries(p.precios).length === 0
                                ? <span className="text-muted">—</span>
                                : Object.entries(p.precios).map(([m, v]) => (
                                    <span key={m} className="prd-precio-chip">
                                      {v.toLocaleString('es-ES', { minimumFractionDigits: 2 })}{' '}
                                      <em>{m}</em>
                                    </span>
                                  ))}
                            </div>
                          </td>

                          {/* Stock — solo en la página de productos físicos */}
                          {esProducto && (
                            <td data-label="Stock">
                              <div className="prd-stock-cell">
                                <span className={`prd-stock-value${stockBajo ? ' prd-stock-low' : ''}`}>
                                  {p.stock_actual.toLocaleString('es-ES')}
                                </span>
                                {stockBajo && (
                                  <span className="prd-stock-alert" title={`Mínimo: ${p.stock_minimo}`}>
                                    <AlertTriangle size={13} strokeWidth={2} />
                                  </span>
                                )}
                              </div>
                            </td>
                          )}

                          {/* Acciones */}
                          <td className="col-actions">
                            <RowActions>
                              <button className="row-actions-item" onClick={() => router.push(`${basePath}/${p.producto_id}`)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                              {p.estado === 'ACTIVO' ? (
                                <>
                                  {esProducto && (
                                    <button className="row-actions-item" onClick={() => setStockProducto(p)}>
                                      <Layers size={15} strokeWidth={2} /> Ajustar stock
                                    </button>
                                  )}
                                  <button className="row-actions-item" onClick={() => openEdit(p)}>
                                    <Pencil size={15} strokeWidth={2} /> Editar
                                  </button>
                                  <button className="row-actions-item row-actions-item-danger"
                                    onClick={() => setConfirmProd(p)} disabled={isPending}>
                                    <Archive size={15} strokeWidth={2} /> Archivar
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button className="row-actions-item"
                                    onClick={() => handleRestaurar(p)} disabled={isPending}>
                                    <RotateCcw size={15} strokeWidth={2} /> Restaurar
                                  </button>
                                  <button className="row-actions-item row-actions-item-danger"
                                    onClick={() => setEliminarProd(p)} disabled={isPending}>
                                    <Trash2 size={15} strokeWidth={2} /> Eliminar
                                  </button>
                                </>
                              )}
                            </RowActions>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <TablePagination {...prodPag} label={sustantivo} />
          </div>

          {/* Barra de acciones en lote */}
          <BulkBar count={sel.count} onClear={sel.clear}>
            {verArchivados ? (
              <>
                <button className="btn btn-secondary btn-sm" disabled={isPending}
                  onClick={() => ejecutarLote(
                    () => archivarProductosEnLote(sel.selectedIds, false),
                    n => `${n} ${sustantivo}${plural(n)} restaurado${plural(n)}`, 'Restaurando…')}>
                  <RotateCcw size={14} strokeWidth={2} /> Restaurar
                </button>
                <button className="btn btn-danger-text btn-sm" disabled={isPending}
                  onClick={() => setConfirmLote('eliminar')}>
                  <Trash2 size={14} strokeWidth={2} /> Eliminar
                </button>
              </>
            ) : (
              <button className="btn btn-danger-text btn-sm" disabled={isPending}
                onClick={() => setConfirmLote('archivar')}>
                <Archive size={14} strokeWidth={2} /> Archivar
              </button>
            )}
          </BulkBar>
        </>
      )}

      {/* ══ TAB CATEGORÍAS ══ */}
      {tab === 'categorias' && (
        <div className="card card-table mt-4">
          <div className="mon-card-header">
            <h2 className="mon-section-title">Categorías</h2>
            <span className="card-count">{data.categorias.length} total</span>
          </div>

          {data.categorias.length === 0 ? (
            <div className="mon-empty">
              <Tag size={36} strokeWidth={1} opacity={0.25} />
              <p>Aún no hay categorías. Crea la primera para organizar tu catálogo.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Se usa en</th>
                    <th>Descripción</th>
                    <th className="prd-cat-col-count col-center">Artículos</th>
                    <th>Estado</th>
                    <th className="col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {catItems.map(c => {
                    const count = productosPorCategoria[c.categoria_id] ?? 0
                    return (
                      <tr key={c.categoria_id} className={c.estado === 'INACTIVO' ? 'ter-row-archivada' : ''}>
                        <td data-label="Nombre"><strong className="text-sm-bold">{c.nombre}</strong></td>
                        <td data-label="Se usa en" className="text-sm-muted">{TIPO_CATEGORIA_LABEL[c.tipo] ?? '—'}</td>
                        <td data-label="Descripción" className="text-sm-muted cell-truncate">{c.descripcion ?? '—'}</td>
                        <td data-label="Artículos" className="col-center">
                          {count > 0 ? (
                            <button
                              className="prd-cat-count-btn"
                              onClick={() => { setTab('productos'); setFiltroCat(c.categoria_id) }}
                              title="Ver artículos de esta categoría"
                            >
                              {count}
                            </button>
                          ) : (
                            <span className="text-sm-muted">—</span>
                          )}
                        </td>
                        <td data-label="Estado">
                          <span className={`badge ${c.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
                            {c.estado === 'ACTIVO' ? 'Activa' : 'Archivada'}
                          </span>
                        </td>
                        <td className="col-actions">
                          <RowActions>
                            {c.estado === 'ACTIVO' ? (
                              <>
                                <button className="row-actions-item" onClick={() => openEditCat(c)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                                <button className="row-actions-item row-actions-item-danger"
                                  onClick={() => setConfirmCat(c)} disabled={isPending}><Archive size={15} strokeWidth={2} /> Archivar</button>
                              </>
                            ) : (
                              <button className="row-actions-item"
                                onClick={() => handleRestaurarCat(c)} disabled={isPending}><RotateCcw size={15} strokeWidth={2} /> Restaurar</button>
                            )}
                          </RowActions>
                        </td>
                      </tr>
                    )
                  })}

                  {/* Fila Sin categoría */}
                  {sinCategoriaCount > 0 && (
                    <tr className="prd-cat-row-special">
                      <td data-label="Nombre">
                        <span className="text-sm-muted text-italic">Sin categoría</span>
                      </td>
                      <td data-label="Descripción" className="text-sm-muted">Artículos sin categoría asignada</td>
                      <td data-label="Artículos" className="col-center">
                        <button
                          className="prd-cat-count-btn prd-cat-count-warn"
                          onClick={() => { setTab('productos'); setFiltroCat('__sin_categoria__') }}
                          title="Ver artículos sin categoría"
                        >
                          {sinCategoriaCount}
                        </button>
                      </td>
                      <td data-label="Estado"><span className="prd-cat-badge-revisar">Revisar</span></td>
                      <td className="col-actions" />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <TablePagination {...catPag} label="categoría" />
        </div>
      )}

      {/* Modales */}
      {productoModal && (
        <ProductoFormModal producto={editProducto} categorias={data.categorias}
          proveedores={data.proveedores} monedas={data.monedas}
          hayAlmacenes={data.almacenes.length > 0}
          modo={data.modo} etiquetaServicio={data.etiquetaServicio}
          onClose={closeModal} onSaved={onSaved} />
      )}
      {stockProducto && (
        <StockAjusteModal
          producto_id={stockProducto.producto_id}
          nombre={stockProducto.nombre}
          unidad={stockProducto.unidad}
          almacenes={data.almacenes}
          onClose={() => setStockProducto(null)}
          onSaved={onStockSaved}
        />
      )}
      {confirmProd && (
        <ConfirmArchivar nombre={confirmProd.nombre} onConfirm={confirmarArchivar}
          onClose={() => setConfirmProd(null)} isPending={isPending} />
      )}
      {eliminarProd && (
        <ConfirmEliminar nombre={eliminarProd.nombre} onConfirm={confirmarEliminar}
          onClose={() => setEliminarProd(null)} isPending={isPending} />
      )}
      {catModal && (
        <CategoriaModal categoria={editCat} modo={data.modo} onClose={closeCatModal} onSaved={onCatSaved} />
      )}
      {confirmCat && (
        <ConfirmArchivar nombre={confirmCat.nombre} onConfirm={confirmarArchivarCat}
          onClose={() => setConfirmCat(null)} isPending={isPending} />
      )}
      {confirmLote === 'archivar' && (
        <ConfirmDialog
          title={`¿Archivar ${sel.count} ${sustantivo}${plural(sel.count)}?`}
          body="No aparecerán en el catálogo activo, pero podrás restaurarlos cuando quieras."
          confirmLabel="Archivar" danger
          onCancel={() => setConfirmLote(null)}
          onConfirm={doArchivarLote}
        />
      )}
      {confirmLote === 'eliminar' && (
        <ConfirmDialog
          title={`¿Eliminar ${sel.count} ${sustantivo}${plural(sel.count)} para siempre?`}
          body="Solo se eliminan los que no tengan ventas, compras, movimientos, catálogo ni tickets; el resto se omite. No se puede deshacer."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmLote(null)}
          onConfirm={doEliminarLote}
        />
      )}
    </div>
  )
}
