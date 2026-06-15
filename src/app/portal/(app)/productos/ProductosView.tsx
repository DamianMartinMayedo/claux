'use client'

import { useToast } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
  const { success: toastSuccess, error: toastError } = useToast()
import { useRouter }                         from 'next/navigation'
import Link                                  from 'next/link'
import {
  archivarProducto,
  restaurarProducto,
  ajustarStock,
  guardarCategoria,
  archivarCategoria,
  restaurarCategoria,
  type Producto,
  type Categoria,
  type TipoProducto,
  type ProductosPageData,
} from '@/app/actions/portal/productos'
import { ProductoFormModal } from './_ProductoFormModal'

// ── StockModal ────────────────────────────────────────────────────────────────

function StockModal({ producto, onClose, onSaved }: {
  producto: Producto; onClose: () => void; onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [cantidad, setCantidad]      = useState('')
  const [motivo,   setMotivo]        = useState('')

  const cantNum    = parseFloat(cantidad)
  const stockNuevo = isNaN(cantNum) ? producto.stock_actual : producto.stock_actual + cantNum

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!cantidad || isNaN(parseFloat(cantidad))) return toastError('Ingresa una cantidad válida.')
    if (parseFloat(cantidad) === 0)               return toastError('La cantidad no puede ser cero.')
    if (!motivo.trim())                           return toastError('El motivo del ajuste es obligatorio.')
    startTransition(async () => {
      const res = await ajustarStock(producto.producto_id, parseFloat(cantidad), motivo)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Ajuste de stock</h2>
          <button type="button" className="modal-close" onClick={onClose}><IconX /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="prd-stock-nombre">{producto.nombre}</p>
            <div className="prd-stock-actual-row">
              <span>Stock actual</span>
              <strong>{producto.stock_actual} {producto.unidad}</strong>
            </div>
            <div className="input-group">
              <label>Cantidad <span className="required">*</span></label>
              <input className="input" type="number" step="0.001"
                placeholder="+ entrada  /  – salida"
                value={cantidad} onChange={e => setCantidad(e.target.value)} autoFocus />
              {!isNaN(cantNum) && cantNum !== 0 && (
                <span className={`input-hint${stockNuevo < 0 ? ' prd-stock-warn' : ''}`}>
                  Stock resultante: <strong>{stockNuevo.toFixed(3)}</strong> {producto.unidad}
                </span>
              )}
            </div>
            <div className="input-group">
              <label>Motivo <span className="required">*</span></label>
              <input className="input" placeholder="Ej: Compra, Ajuste de inventario, Merma…"
                value={motivo} onChange={e => setMotivo(e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Aplicando…</> : 'Aplicar ajuste'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── CategoriaModal ────────────────────────────────────────────────────────────

function CategoriaModal({ categoria, onClose, onSaved }: {
  categoria: Categoria | null; onClose: () => void; onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!categoria

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await guardarCategoria(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar categoría' : 'Nueva categoría'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><IconX /></button>
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
          <button type="button" className="modal-close" onClick={onClose}><IconX /></button>
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

// ── Tab ───────────────────────────────────────────────────────────────────────

function Tab({ active, onClick, icon, label, count }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number
}) {
  return (
    <button onClick={onClick} className={`prd-tab${active ? ' active' : ''}`}>
      {icon}
      {label}
      <span className="prd-tab-count">{count}</span>
    </button>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function ProductosView({ data }: { data: ProductosPageData }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [tab,           setTab]          = useState<'productos' | 'categorias'>('productos')
  const [productoModal, setProductoModal] = useState(false)
  const [editProducto,  setEditProducto]  = useState<Producto | null>(null)
  const [stockProducto, setStockProducto] = useState<Producto | null>(null)
  const [confirmProd,   setConfirmProd]   = useState<Producto | null>(null)
  const [search,        setSearch]        = useState('')
  const [filtroTipo,    setFiltroTipo]    = useState<'TODOS' | TipoProducto>('TODOS')
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
      if (filtroTipo !== 'TODOS' && p.tipo !== filtroTipo) return false
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
  }, [data.productos, search, filtroTipo, filtroCat, filtroProv, verArchivados, categoriaMap])

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
          <h1 className="page-title">Productos y Servicios</h1>
          <p className="page-subtitle">Catálogo de bienes y servicios del cliente.</p>
        </div>
        {tab === 'productos'
          ? <button className="btn btn-primary" onClick={openCreate}><IconPlus /> Nuevo</button>
          : <button className="btn btn-primary" onClick={openCreateCat}><IconPlus /> Nueva categoría</button>
        }
      </div>

      {/* ── Tabs ── */}
      <div className="prd-tabs">
        <Tab active={tab === 'productos'}  onClick={() => setTab('productos')}  icon={<IconBox />} label="Productos y servicios" count={activos} />
        <Tab active={tab === 'categorias'} onClick={() => setTab('categorias')} icon={<IconTag />} label="Categorías" count={categoriasActivas.length} />
      </div>

      {/* ══ TAB PRODUCTOS ══ */}
      {tab === 'productos' && (
        <>
          {/* Toolbar */}
          <div className="ter-toolbar">
            <div className="ter-search-wrap">
              <IconSearch />
              <input type="search" className="ter-search"
                placeholder="Buscar por nombre, código, categoría…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="input ter-filter-select" value={filtroTipo}
              onChange={e => setFiltroTipo(e.target.value as typeof filtroTipo)}>
              <option value="TODOS">Todos los tipos</option>
              <option value="PRODUCTO">Productos</option>
              <option value="SERVICIO">Servicios</option>
            </select>
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
                <IconBoxLg />
                <p>{data.productos.length === 0
                  ? 'Aún no hay productos en el catálogo. Crea el primero.'
                  : 'No hay resultados para los filtros seleccionados.'}</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Código</th>
                      <th>Tipo</th>
                      <th>Categoría</th>
                      <th>Precios de venta</th>
                      <th>Stock</th>
                      <th className="prd-col-act"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {productosFiltrados.map(p => {
                      const stockBajo = p.tipo === 'PRODUCTO' && p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo
                      return (
                        <tr
                          key={p.producto_id}
                          className={`table-row-clickable${p.estado === 'INACTIVO' ? ' ter-row-archivada' : ''}`}
                          onClick={() => router.push(`/portal/productos/${p.producto_id}`)}
                        >
                          {/* Nombre */}
                          <td>
                            <Link
                              href={`/portal/productos/${p.producto_id}`}
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
                          <td>
                            <span className="code-value">{p.codigo}</span>
                            {p.codigo_proveedor && (
                              <div className="table-cell-secondary">{p.codigo_proveedor}</div>
                            )}
                          </td>

                          {/* Tipo */}
                          <td>
                            <span className={`badge ${p.tipo === 'PRODUCTO' ? 'badge-info' : 'badge-purple'}`}>
                              {p.tipo === 'PRODUCTO' ? 'Producto' : 'Servicio'}
                            </span>
                          </td>

                          {/* Categoría */}
                          <td className="text-sm-muted">
                            {p.categoria_id ? (categoriaMap[p.categoria_id] ?? '—') : '—'}
                          </td>

                          {/* Precios */}
                          <td>
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

                          {/* Stock */}
                          <td>
                            {p.tipo === 'PRODUCTO' ? (
                              <div className="prd-stock-cell">
                                <span className={`prd-stock-value${stockBajo ? ' prd-stock-low' : ''}`}>
                                  {p.stock_actual.toLocaleString('es-VE')}
                                </span>
                                {stockBajo && (
                                  <span className="prd-stock-alert" title={`Mínimo: ${p.stock_minimo}`}>
                                    <IconAlertTriangle />
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs-muted">—</span>
                            )}
                          </td>

                          {/* Acciones */}
                          <td>
                            <div className="ter-actions" onClick={(e) => e.stopPropagation()}>
                              {p.estado === 'ACTIVO' ? (
                                <>
                                  {p.tipo === 'PRODUCTO' && (
                                    <button className="ter-action-btn" title="Ajustar stock" onClick={() => setStockProducto(p)}>
                                      <IconLayers />
                                    </button>
                                  )}
                                  <button className="ter-action-btn" title="Editar" onClick={() => openEdit(p)}>
                                    <IconEdit />
                                  </button>
                                  <button className="ter-action-btn ter-action-danger" title="Archivar"
                                    onClick={() => setConfirmProd(p)} disabled={isPending}>
                                    <IconArchive />
                                  </button>
                                </>
                              ) : (
                                <button className="ter-action-btn ter-action-restore" title="Restaurar"
                                  onClick={() => handleRestaurar(p)} disabled={isPending}>
                                  <IconRestore />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
              <IconTagLg />
              <p>Aún no hay categorías. Crea la primera para organizar tu catálogo.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Descripción</th>
                    <th className="prd-cat-col-count text-center">Productos</th>
                    <th>Estado</th>
                    <th className="prd-col-act-sm"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.categorias.map(c => {
                    const count = productosPorCategoria[c.categoria_id] ?? 0
                    return (
                      <tr key={c.categoria_id} className={c.estado === 'INACTIVO' ? 'ter-row-archivada' : ''}>
                        <td><strong className="text-sm-bold">{c.nombre}</strong></td>
                        <td className="text-sm-muted">{c.descripcion ?? '—'}</td>
                        <td className="text-center">
                          {count > 0 ? (
                            <button
                              className="prd-cat-count-btn"
                              onClick={() => { setTab('productos'); setFiltroCat(c.categoria_id) }}
                              title="Ver productos de esta categoría"
                            >
                              {count}
                            </button>
                          ) : (
                            <span className="text-sm-muted">—</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${c.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
                            {c.estado === 'ACTIVO' ? 'Activa' : 'Archivada'}
                          </span>
                        </td>
                        <td>
                          <div className="ter-actions">
                            {c.estado === 'ACTIVO' ? (
                              <>
                                <button className="ter-action-btn" title="Editar" onClick={() => openEditCat(c)}><IconEdit /></button>
                                <button className="ter-action-btn ter-action-danger" title="Archivar"
                                  onClick={() => setConfirmCat(c)} disabled={isPending}><IconArchive /></button>
                              </>
                            ) : (
                              <button className="ter-action-btn ter-action-restore" title="Restaurar"
                                onClick={() => handleRestaurarCat(c)} disabled={isPending}><IconRestore /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                  {/* Fila Sin categoría */}
                  {sinCategoriaCount > 0 && (
                    <tr className="prd-cat-row-special">
                      <td>
                        <span className="text-sm-muted text-italic">Sin categoría</span>
                      </td>
                      <td className="text-sm-muted">Productos sin categoría asignada</td>
                      <td className="text-center">
                        <button
                          className="prd-cat-count-btn prd-cat-count-warn"
                          onClick={() => { setTab('productos'); setFiltroCat('__sin_categoria__') }}
                          title="Ver productos sin categoría"
                        >
                          {sinCategoriaCount}
                        </button>
                      </td>
                      <td><span className="prd-cat-badge-revisar">Revisar</span></td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modales */}
      {productoModal && (
        <ProductoFormModal producto={editProducto} categorias={data.categorias}
          proveedores={data.proveedores} monedas={data.monedas}
          onClose={closeModal} onSaved={onSaved} />
      )}
      {stockProducto && (
        <StockModal producto={stockProducto} onClose={() => setStockProducto(null)} onSaved={onStockSaved} />
      )}
      {confirmProd && (
        <ConfirmArchivar nombre={confirmProd.nombre} onConfirm={confirmarArchivar}
          onClose={() => setConfirmProd(null)} isPending={isPending} />
      )}
      {catModal && (
        <CategoriaModal categoria={editCat} onClose={closeCatModal} onSaved={onCatSaved} />
      )}
      {confirmCat && (
        <ConfirmArchivar nombre={confirmCat.nombre} onConfirm={confirmarArchivarCat}
          onClose={() => setConfirmCat(null)} isPending={isPending} />
      )}
    </div>
  )
}

// ── Iconos ────────────────────────────────────────────────────────────────────

function IconPlus()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> }
function IconX()      { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
function IconSearch() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> }
function IconEdit()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function IconArchive(){ return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> }
function IconRestore(){ return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg> }
function IconBox()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> }
function IconBoxLg()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="36" height="36" opacity="0.25"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> }
function IconTag()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> }
function IconTagLg()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="36" height="36" opacity="0.25"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> }
function IconLayers()        { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> }
function IconAlertTriangle() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> }
