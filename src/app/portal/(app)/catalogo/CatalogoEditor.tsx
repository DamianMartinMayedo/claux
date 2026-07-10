'use client'

import { useState, useTransition, useMemo, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import {
  guardarCategoria, eliminarCategoria, eliminarItem,
  marcarDisponible, guardarSlug, guardarMonedaCatalogo, importarDesdeProductos,
  type CatalogoData, type CatalogoItem, type CatalogoCategoria,
} from '@/app/actions/portal/catalogo'
import { RowActions } from '@/components/portal/RowActions'
import { ConfirmDialog } from '@/components/portal/Dialog'
import ItemModal from './ItemModal'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { useIa } from '@/components/portal/ia/IaContext'
import {
  Plus, Pencil, Trash2, X, Check, Loader2, EyeOff, Eye, QrCode, Copy,
  Download, Package, LayoutGrid, List, FolderTree,
} from 'lucide-react'

type Tab = 'items' | 'categorias' | 'configuracion'
type Vista = 'card' | 'lista'

export default function CatalogoEditor({ data }: { data: CatalogoData }) {
  const router = useRouter()
  const { tieneIa } = useIa()
  const [tab, setTab] = useState<Tab>('items')
  const [vista, setVista] = useState<Vista>('card')
  const [modalCategoria, setModalCategoria] = useState<CatalogoCategoria | null | 'nueva'>(null)
  const [modalItem, setModalItem] = useState<CatalogoItem | null | 'nuevo'>(null)
  const [filtroCategoria, setFiltroCategoria] = useState<string>('todas')
  const [confirmarItem, setConfirmarItem] = useState<CatalogoItem | null>(null)
  const [confirmarCat, setConfirmarCat] = useState<CatalogoCategoria | null>(null)
  const [, startDelete] = useTransition()

  function onSaved() { router.refresh() }

  // Borrado con confirmación in-app (ConfirmDialog, patrón de la plataforma),
  // centralizado en el padre para no anidar un modal dentro de la tarjeta/fila
  // clicable ni usar el confirm() del navegador.
  function doEliminarItem(it: CatalogoItem) {
    setConfirmarItem(null)
    startDelete(async () => {
      const r = await eliminarItem(it.item_id)
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess('Producto eliminado.')
      onSaved()
    })
  }
  function doEliminarCategoria(c: CatalogoCategoria) {
    setConfirmarCat(null)
    startDelete(async () => {
      const r = await eliminarCategoria(c.categoria_id)
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess('Categoría eliminada.')
      onSaved()
    })
  }

  // Ítems agrupados por categoría (orden de categorías + orden interno del ítem).
  // El grupo "Sin categoría" va al final. El chip de filtro acota qué grupos se ven.
  const grupos = useMemo(() => {
    const porCat = new Map<string, CatalogoItem[]>()
    const sin: CatalogoItem[] = []
    for (const it of data.items) {
      if (it.categoria_id) {
        if (!porCat.has(it.categoria_id)) porCat.set(it.categoria_id, [])
        porCat.get(it.categoria_id)!.push(it)
      } else sin.push(it)
    }
    const gs: { id: string; nombre: string; descuento: number; items: CatalogoItem[] }[] = []
    for (const c of data.categorias) {
      const its = porCat.get(c.categoria_id)
      if (its?.length) gs.push({ id: c.categoria_id, nombre: c.nombre, descuento: c.descuento_pct, items: its })
    }
    if (sin.length) gs.push({ id: '__sin__', nombre: 'Sin categoría', descuento: 0, items: sin })
    return gs
  }, [data.items, data.categorias])

  const gruposFiltrados = useMemo(
    () => filtroCategoria === 'todas' ? grupos : grupos.filter(g => g.id === filtroCategoria),
    [grupos, filtroCategoria],
  )
  const hayItems = data.items.length > 0
  // Sin cabecera de sección cuando el único grupo es "Sin categoría".
  const soloSin = gruposFiltrados.length === 1 && gruposFiltrados[0].id === '__sin__'
  const colSpanLista = data.tieneInventario ? 6 : 5

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">{data.etiquetas.catalogo}</h1>
            <IaTouchpoint tipo="catalogo" descripcion="una revisión de tu catálogo" />
          </div>
          <p className="page-subtitle">Gestiona lo que verán tus clientes al abrir tu {data.etiquetas.catalogo.toLowerCase()}.</p>
        </div>
        {tab === 'items' && (
          <button className="btn btn-primary" onClick={() => setModalItem('nuevo')}>
            <Plus size={16} strokeWidth={2} /> Producto
          </button>
        )}
        {tab === 'categorias' && (
          <button className="btn btn-primary" onClick={() => setModalCategoria('nueva')}>
            <Plus size={16} strokeWidth={2} /> Categoría
          </button>
        )}
      </div>

      <div className="res-tabs">
        <button className={`res-tab ${tab === 'items' ? 'active' : ''}`} onClick={() => setTab('items')}>Ítems</button>
        <button className={`res-tab ${tab === 'categorias' ? 'active' : ''}`} onClick={() => setTab('categorias')}>Categorías</button>
        <button className={`res-tab ${tab === 'configuracion' ? 'active' : ''}`} onClick={() => setTab('configuracion')}>Configuración y QR</button>
      </div>

      {tab === 'items' && (
        <>
          <div className="cat-items-toolbar">
            {data.categorias.length > 0 ? (
              <div className="cat-filtros">
                <button className={`cat-filtro-chip ${filtroCategoria === 'todas' ? 'active' : ''}`} onClick={() => setFiltroCategoria('todas')}>
                  Todas
                </button>
                {data.categorias.map(c => (
                  <button key={c.categoria_id}
                    className={`cat-filtro-chip ${filtroCategoria === c.categoria_id ? 'active' : ''}`}
                    onClick={() => setFiltroCategoria(c.categoria_id)}>
                    {c.nombre}
                  </button>
                ))}
              </div>
            ) : <span />}
            <div className="cat-viewtoggle" role="group" aria-label="Cambiar vista">
              <button className={`cat-viewtoggle-btn ${vista === 'card' ? 'active' : ''}`}
                onClick={() => setVista('card')} aria-label="Vista de tarjetas" aria-pressed={vista === 'card'}>
                <LayoutGrid size={16} strokeWidth={2} />
              </button>
              <button className={`cat-viewtoggle-btn ${vista === 'lista' ? 'active' : ''}`}
                onClick={() => setVista('lista')} aria-label="Vista de lista" aria-pressed={vista === 'lista'}>
                <List size={16} strokeWidth={2} />
              </button>
            </div>
          </div>

          {!hayItems ? (
            <div className="card cat-empty">
              <Package size={32} strokeWidth={1.5} />
              <p>Aún no has añadido productos a tu {data.etiquetas.catalogo.toLowerCase()}.</p>
              <button className="btn btn-primary" onClick={() => setModalItem('nuevo')}>
                <Plus size={16} strokeWidth={2} /> Añadir el primero
              </button>
            </div>
          ) : vista === 'card' ? (
            gruposFiltrados.map(g => (
              <section key={g.id} className="cat-cat-section">
                {!soloSin && (
                  <h3 className="cat-cat-section-title">
                    {g.nombre}
                    {g.descuento > 0 && <span className="badge badge-fill badge-success cat-desc-badge">-{g.descuento}%</span>}
                  </h3>
                )}
                <div className="cat-grid">
                  {g.items.map(item => (
                    <ItemCard key={item.item_id} item={item} tieneInventario={data.tieneInventario}
                      onEdit={() => setModalItem(item)} onDelete={() => setConfirmarItem(item)} onSaved={onSaved} />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="card card-table">
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Producto</th>
                      <th className="col-num">Precio</th>
                      <th className="col-center">Estado</th>
                      {data.tieneInventario && <th className="col-num">Stock</th>}
                      <th className="col-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {gruposFiltrados.map(g => (
                      <Fragment key={g.id}>
                        {!soloSin && (
                          <tr className="cat-cat-header-row">
                            <td colSpan={colSpanLista}>
                              {g.nombre}
                              {g.descuento > 0 && <span className="badge badge-fill badge-success cat-desc-badge">-{g.descuento}%</span>}
                            </td>
                          </tr>
                        )}
                        {g.items.map(item => (
                          <ItemRow key={item.item_id} item={item} tieneInventario={data.tieneInventario}
                            onEdit={() => setModalItem(item)} onDelete={() => setConfirmarItem(item)} onSaved={onSaved} />
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'categorias' && (
        <CategoriasTab
          categorias={data.categorias}
          items={data.items}
          onNueva={() => setModalCategoria('nueva')}
          onEditar={c => setModalCategoria(c)}
          onEliminar={c => setConfirmarCat(c)}
        />
      )}

      {tab === 'configuracion' && (
        <ConfiguracionTab data={data} onSaved={onSaved} />
      )}

      {modalCategoria !== null && (
        <CategoriaModal
          categoria={modalCategoria === 'nueva' ? null : modalCategoria}
          onClose={() => setModalCategoria(null)}
          onSaved={() => { setModalCategoria(null); onSaved() }}
        />
      )}

      {modalItem !== null && (
        <ItemModal
          item={modalItem === 'nuevo' ? null : modalItem}
          categorias={data.categorias}
          monedaCatalogo={data.monedaCatalogo}
          monedasActivas={data.monedasActivas}
          tieneIa={tieneIa}
          onClose={() => setModalItem(null)}
          onSaved={() => { setModalItem(null); onSaved() }}
        />
      )}

      {confirmarItem && (
        <ConfirmDialog
          title={`¿Eliminar "${confirmarItem.nombre}"?`}
          body={`Se quitará de tu ${data.etiquetas.catalogo.toLowerCase()}. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmarItem(null)}
          onConfirm={() => doEliminarItem(confirmarItem)}
        />
      )}

      {confirmarCat && (
        <ConfirmDialog
          title={`¿Eliminar la categoría "${confirmarCat.nombre}"?`}
          body="Los productos no se borran: quedan sin categoría."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmarCat(null)}
          onConfirm={() => doEliminarCategoria(confirmarCat)}
        />
      )}
    </div>
  )
}

// ── Tarjeta de ítem ────────────────────────────────────────────────────────────

function ItemCard({ item, tieneInventario, onEdit, onDelete, onSaved }: {
  item: CatalogoItem; tieneInventario: boolean; onEdit: () => void; onDelete: () => void; onSaved: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function toggleDisponible() {
    startTransition(async () => {
      const r = await marcarDisponible(item.item_id, !item.disponible)
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className={`cat-card cat-card-link ${!item.disponible ? 'cat-card-agotado' : ''}`}
      role="button" tabIndex={0}
      onClick={() => router.push(`/portal/catalogo/${item.item_id}`)}
      onKeyDown={e => { if (e.key === 'Enter') router.push(`/portal/catalogo/${item.item_id}`) }}>
      <div className="cat-card-photo">
        {item.foto_thumb_url
          ? <span className="cat-card-photo-img" style={{ '--preview': `url(${item.foto_thumb_url})` } as React.CSSProperties} />
          : <span className="cat-card-photo-empty"><Package size={28} strokeWidth={1.5} /></span>}
        {!item.disponible && <span className="badge badge-neutral cat-card-badge">Agotado</span>}
        {item.descuentoPct ? <span className="badge badge-fill badge-success cat-card-badge-desc">-{item.descuentoPct}%</span> : null}
      </div>
      <div className="cat-card-body">
        <div className="cat-card-top">
          <strong className="cat-card-nombre">{item.nombre}</strong>
          <RowActions>
            <button className="row-actions-item" onClick={() => router.push(`/portal/catalogo/${item.item_id}`)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
            <button className="row-actions-item" onClick={onEdit}><Pencil size={15} strokeWidth={2} /> Editar</button>
            <button className="row-actions-item" onClick={toggleDisponible} disabled={isPending}>
              {item.disponible ? <><EyeOff size={15} strokeWidth={2} /> Marcar agotado</> : <><Eye size={15} strokeWidth={2} /> Marcar disponible</>}
            </button>
            <button className="row-actions-item row-actions-item-danger" onClick={onDelete} disabled={isPending}>
              <Trash2 size={14} strokeWidth={2} /> Eliminar
            </button>
          </RowActions>
        </div>
        {item.descripcion && <p className="cat-card-desc">{item.descripcion}</p>}
        <Precio item={item} className="cat-card-precio" antesClassName="cat-precio-antes" />
        {tieneInventario && item.stock != null && (
          <p className="cat-card-stock">Stock: {item.stock}</p>
        )}
      </div>
    </div>
  )
}

// Muestra el precio final y, si hay descuento, el original tachado. Reutilizado
// por la tarjeta, la fila y el detalle del portal.
function Precio({ item, className, antesClassName }: {
  item: CatalogoItem; className?: string; antesClassName?: string
}) {
  if (item.precioMostrado == null) return <span className={className}>—</span>
  const moneda = item.monedaMostrada ?? ''
  return (
    <span className={className}>
      {item.precioAntes != null && (
        <span className={antesClassName}>{item.precioAntes.toFixed(2)} {moneda}</span>
      )}
      {item.precioMostrado.toFixed(2)} {moneda}
    </span>
  )
}

// ── Fila de ítem (vista lista) ───────────────────────────────────────────────

function ItemRow({ item, tieneInventario, onEdit, onDelete, onSaved }: {
  item: CatalogoItem; tieneInventario: boolean; onEdit: () => void; onDelete: () => void; onSaved: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function toggleDisponible() {
    startTransition(async () => {
      const r = await marcarDisponible(item.item_id, !item.disponible)
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <tr className={`table-row-clickable ${!item.disponible ? 'cat-row-agotado' : ''}`}
      onClick={() => router.push(`/portal/catalogo/${item.item_id}`)}>
      <td data-label="" className="cat-row-thumb-cell">
        <span className="cat-row-thumb">
          {item.foto_thumb_url
            ? <span className="cat-row-thumb-img" style={{ '--preview': `url(${item.foto_thumb_url})` } as React.CSSProperties} />
            : <Package size={18} strokeWidth={1.5} />}
        </span>
      </td>
      <td data-label="Producto"><strong>{item.nombre}</strong></td>
      <td data-label="Precio" className="col-num">
        <Precio item={item} antesClassName="cat-precio-antes" />
      </td>
      <td data-label="Estado" className="col-center">
        <span className={`badge ${item.disponible ? 'badge-success' : 'badge-neutral'}`}>
          {item.disponible ? 'Disponible' : 'Agotado'}
        </span>
      </td>
      {tieneInventario && (
        <td data-label="Stock" className="col-num">{item.stock != null ? item.stock : '—'}</td>
      )}
      <td className="col-actions">
        <RowActions>
          <button className="row-actions-item" onClick={() => router.push(`/portal/catalogo/${item.item_id}`)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
          <button className="row-actions-item" onClick={onEdit}><Pencil size={15} strokeWidth={2} /> Editar</button>
          <button className="row-actions-item" onClick={toggleDisponible} disabled={isPending}>
            {item.disponible ? <><EyeOff size={15} strokeWidth={2} /> Marcar agotado</> : <><Eye size={15} strokeWidth={2} /> Marcar disponible</>}
          </button>
          <button className="row-actions-item row-actions-item-danger" onClick={onDelete} disabled={isPending}>
            <Trash2 size={14} strokeWidth={2} /> Eliminar
          </button>
        </RowActions>
      </td>
    </tr>
  )
}

// ── Tab: Categorías ──────────────────────────────────────────────────────────

function CategoriasTab({ categorias, items, onNueva, onEditar, onEliminar }: {
  categorias: CatalogoCategoria[]
  items: CatalogoItem[]
  onNueva: () => void
  onEditar: (c: CatalogoCategoria) => void
  onEliminar: (c: CatalogoCategoria) => void
}) {
  const conteo = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) if (it.categoria_id) m.set(it.categoria_id, (m.get(it.categoria_id) ?? 0) + 1)
    return m
  }, [items])
  const sinCategoria = items.filter(i => !i.categoria_id).length

  if (categorias.length === 0) {
    return (
      <div className="card cat-empty">
        <FolderTree size={32} strokeWidth={1.5} />
        <p>Aún no tienes categorías. Agrúpalas para que tus clientes encuentren los productos más rápido.</p>
        <button className="btn btn-primary" onClick={onNueva}>
          <Plus size={16} strokeWidth={2} /> Nueva categoría
        </button>
      </div>
    )
  }

  return (
    <div className="card card-table">
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th className="col-num">Productos</th>
              <th className="col-num">Descuento</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {categorias.map(c => (
              <tr key={c.categoria_id} className="table-row-clickable" onClick={() => onEditar(c)}>
                <td data-label="Categoría"><strong>{c.nombre}</strong></td>
                <td data-label="Productos" className="col-num">{conteo.get(c.categoria_id) ?? 0}</td>
                <td data-label="Descuento" className="col-num">{c.descuento_pct > 0 ? `-${c.descuento_pct}%` : '—'}</td>
                <td className="col-actions">
                  <RowActions>
                    <button className="row-actions-item" onClick={() => onEditar(c)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                    <button className="row-actions-item row-actions-item-danger" onClick={() => onEliminar(c)}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
                  </RowActions>
                </td>
              </tr>
            ))}
            {sinCategoria > 0 && (
              <tr>
                <td data-label="Categoría"><span className="cat-cat-sin">Sin categoría</span></td>
                <td data-label="Productos" className="col-num">{sinCategoria}</td>
                <td data-label="Descuento" className="col-num">—</td>
                <td className="col-actions"></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Modal: categoría ─────────────────────────────────────────────────────────

function CategoriaModal({ categoria, onClose, onSaved }: {
  categoria: CatalogoCategoria | null; onClose: () => void; onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const r = await guardarCategoria(fd)
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess('Categoría guardada.')
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{categoria ? 'Editar categoría' : 'Nueva categoría'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <input type="hidden" name="categoria_id" defaultValue={categoria?.categoria_id ?? ''} />
          <div className="modal-body">
            <div className="input-group">
              <label htmlFor="cat-nombre">Nombre <span className="required">*</span></label>
              <input id="cat-nombre" name="nombre" className="input" defaultValue={categoria?.nombre ?? ''} required autoFocus />
            </div>
            <div className="input-group">
              <label htmlFor="cat-descuento">Descuento de la categoría (%)</label>
              <input id="cat-descuento" name="descuento_pct" type="number" min="0" max="100" step="0.01"
                className="input" defaultValue={categoria?.descuento_pct ? categoria.descuento_pct : ''} placeholder="0" />
              <p className="input-hint">Se aplica a todos los productos del grupo que no tengan su propio descuento.</p>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <Loader2 size={16} strokeWidth={2} className="img-upload-spin" /> : <Check size={16} strokeWidth={2} />} Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Tab: Configuración + QR ──────────────────────────────────────────────────

function ConfiguracionTab({ data, onSaved }: { data: CatalogoData; onSaved: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [isImporting, startImport] = useTransition()
  const [isSavingMoneda, startMoneda] = useTransition()
  const [slugInput, setSlugInput] = useState(data.slug ?? '')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [generandoQr, setGenerandoQr] = useState(false)

  const origen = typeof window !== 'undefined' ? window.location.origin : ''
  const url = data.slug ? `${origen}/${data.slug}/catalogo` : null

  function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const r = await guardarSlug(fd)
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess('Enlace guardado.')
      onSaved()
    })
  }

  function copiarEnlace() {
    if (!url) return
    navigator.clipboard.writeText(url).then(() => toastSuccess('Enlace copiado.'))
  }

  async function generarQr() {
    if (!url) return
    setGenerandoQr(true)
    try {
      const QRCode = (await import('qrcode')).default
      const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 2 })
      setQrDataUrl(dataUrl)
    } catch {
      toastError('No se pudo generar el QR.')
    } finally {
      setGenerandoQr(false)
    }
  }

  function descargarQr() {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `qr-${data.slug ?? 'catalogo'}.png`
    a.click()
  }

  function importar() {
    startImport(async () => {
      const r = await importarDesdeProductos()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess(r.creados ? `${r.creados} producto(s) importado(s).` : 'No hay productos nuevos que importar.')
      onSaved()
    })
  }

  function cambiarMoneda(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    // Transición propia: no debe activar el spinner del botón "Guardar" del enlace.
    startMoneda(async () => {
      const r = await guardarMonedaCatalogo(val)
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess(`Moneda del ${data.etiquetas.catalogo.toLowerCase()} actualizada.`)
      onSaved()
    })
  }

  return (
    <div className="cat-config-grid">
      <div className="card">
        <div className="card-header"><h2 className="card-title">Moneda del {data.etiquetas.catalogo.toLowerCase()}</h2></div>
        <div className="input-group">
          <label htmlFor="cat-moneda" className="cat-moneda-label">
            Los precios se muestran en esta moneda
            {isSavingMoneda && <span className="cat-moneda-loading"><Loader2 size={13} strokeWidth={2} className="img-upload-spin" /> Actualizando…</span>}
          </label>
          <select id="cat-moneda" className="input" value={data.monedaCatalogo} onChange={cambiarMoneda} disabled={isSavingMoneda || data.monedasActivas.length === 0}>
            {data.monedasActivas.length === 0
              ? <option value={data.monedaCatalogo}>{data.monedaCatalogo}</option>
              : data.monedasActivas.map(m => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.simbolo && m.simbolo !== m.codigo ? `${m.codigo} — ${m.simbolo}` : m.codigo}
                  </option>
                ))}
          </select>
        </div>
        <p className="input-hint">Cada producto guarda su precio en su moneda; tu {data.etiquetas.catalogo.toLowerCase()} los convierte a esta según la tasa de cambio vigente (Monedas y tasas). No cambia tu enlace público.</p>
      </div>

      <div className="card">
        <div className="card-header"><h2 className="card-title">Enlace público</h2></div>
        <form onSubmit={guardar} className="cat-form-row-inline">
          <div className="input-group cat-input-grow">
            <label htmlFor="cat-slug">Identificador (parte final de tu enlace)</label>
            <input id="cat-slug" name="slug" className="input" value={slugInput}
              onChange={e => setSlugInput(e.target.value)} placeholder="mi-negocio" />
          </div>
          <button type="submit" className="btn btn-primary" disabled={isPending}>
            {isPending ? <Loader2 size={16} strokeWidth={2} className="img-upload-spin" /> : <Check size={16} strokeWidth={2} />} Guardar
          </button>
        </form>

        {url && (
          <div className="cat-url-row">
            <code className="code-block-value-text">{url}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copiarEnlace}>
              <Copy size={14} strokeWidth={2} /> Copiar
            </button>
          </div>
        )}
        {!data.slug && <p className="input-hint">Define un identificador para poder compartir tu {data.etiquetas.catalogo.toLowerCase()} y generar el QR.</p>}
      </div>

      {url && (
        <div className="card cat-qr-card">
          <div className="card-header"><h2 className="card-title">Código QR</h2></div>
          {qrDataUrl ? (
            <div className="cat-qr-preview">
              <Image src={qrDataUrl} alt={`QR de ${url}`} width={220} height={220} unoptimized />
              <button type="button" className="btn btn-secondary" onClick={descargarQr}>
                <Download size={16} strokeWidth={2} /> Descargar PNG
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={generarQr} disabled={generandoQr}>
              {generandoQr ? <Loader2 size={16} strokeWidth={2} className="img-upload-spin" /> : <QrCode size={16} strokeWidth={2} />}
              Generar QR
            </button>
          )}
        </div>
      )}

      {data.tieneInventario && (
        <div className="card">
          <div className="card-header"><h2 className="card-title">Importar desde Inventario</h2></div>
          <p className="input-hint">Trae tus productos activos de Inventario como productos del catálogo (no duplica los ya vinculados).</p>
          <button type="button" className="btn btn-secondary" onClick={importar} disabled={isImporting}>
            {isImporting ? <Loader2 size={16} strokeWidth={2} className="img-upload-spin" /> : <Package size={16} strokeWidth={2} />}
            Importar productos
          </button>
        </div>
      )}
    </div>
  )
}
