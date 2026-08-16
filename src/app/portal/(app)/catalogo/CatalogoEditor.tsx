'use client'

import { useState, useTransition, useMemo, useEffect, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import {
  guardarCategoria, eliminarCategoria, eliminarItem,
  marcarDisponible, marcarDisponibleEnLote, eliminarItemsEnLote,
  guardarMonedaCatalogo, importarDesdeProductos,
  reordenarItems, reordenarCategorias, duplicarItem,
  type CatalogoData, type CatalogoItem, type CatalogoCategoria,
  type ResultadoLoteCatalogo, type TipoImportacion,
} from '@/app/actions/portal/catalogo'
import { guardarSlug } from '@/app/actions/portal/agenda-comun'
import { sufijoPeriodo } from '@/lib/catalogo-periodo'
import QrEnlace from '@/components/portal/QrEnlace'
import { RowActions } from '@/components/portal/RowActions'
import FormHelp from '@/components/portal/FormHelp'
import { ConfirmDialog } from '@/components/portal/Dialog'
import Tabs from '@/components/Tabs'
import BulkBar from '@/components/portal/BulkBar'
import { useRowSelection } from '@/components/portal/useRowSelection'
import ItemModal from './ItemModal'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { useIa } from '@/components/portal/ia/IaContext'
import {
  Plus, Pencil, Trash2, X, Check, Loader2, EyeOff, Eye, Copy,
  Download, Package, FolderTree, ChevronUp, ChevronDown,
} from 'lucide-react'
import ExportarMenu from '@/components/portal/ExportarMenu'

type Tab = 'items' | 'categorias' | 'configuracion'

export default function CatalogoEditor({ data, puedeEditar, children }: { data: CatalogoData; puedeEditar: boolean; children?: React.ReactNode }) {
  const router = useRouter()
  const { tieneIa } = useIa()
  // Etiqueta del ítem en el idioma del negocio («Plato», «Artículo», «Servicio»):
  // la pestaña dice «Ítems» pero botones, toasts y estados vacíos hablan del ítem.
  const art = data.etiquetas.articulo
  const artL = art.toLowerCase()
  const artsL = `${artL}s`
  const esComida = data.etiquetas.catalogoIcono === 'comida'
  const [tab, setTab] = useState<Tab>('items')
  const [modalCategoria, setModalCategoria] = useState<CatalogoCategoria | null | 'nueva'>(null)
  const [modalItem, setModalItem] = useState<CatalogoItem | null | 'nuevo'>(null)
  const [filtroCategoria, setFiltroCategoria] = useState<string>('todas')
  const [confirmarItem, setConfirmarItem] = useState<CatalogoItem | null>(null)
  const [confirmarCat, setConfirmarCat] = useState<CatalogoCategoria | null>(null)
  const [confirmarLote, setConfirmarLote] = useState(false)
  const [, startDelete] = useTransition()
  const [isBulk, startBulk] = useTransition()
  const [isReordenando, startReorder] = useTransition()

  function onSaved() { router.refresh() }

  // Subir/bajar dentro de una lista ya ordenada (ítems de una categoría, o las
  // categorías): intercambia con el vecino y persiste el nuevo orden. Con teclado
  // (a11y) y sin dependencias; el arrastre sería un refinamiento posterior.
  function reordenar(
    ids: string[], index: number, dir: -1 | 1,
    accion: (ids: string[]) => Promise<{ ok: boolean; error?: string }>,
  ) {
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    const nuevo = [...ids]
    ;[nuevo[index], nuevo[j]] = [nuevo[j], nuevo[index]]
    const ld = toastLoading('Reordenando…')
    startReorder(async () => {
      const r = await accion(nuevo)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  // Borrado con confirmación in-app (ConfirmDialog, patrón de la plataforma),
  // centralizado en el padre para no anidar un modal dentro de la tarjeta/fila
  // clicable ni usar el confirm() del navegador.
  function doEliminarItem(it: CatalogoItem) {
    setConfirmarItem(null)
    const ld = toastLoading('Eliminando…')
    startDelete(async () => {
      const r = await eliminarItem(it.item_id)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess(`${art} eliminado.`)
      onSaved()
    })
  }
  function doDuplicar(it: CatalogoItem) {
    const ld = toastLoading('Duplicando…')
    startDelete(async () => {
      const r = await duplicarItem(it.item_id)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess(`${art} duplicado.`)
      onSaved()
    })
  }
  function doEliminarCategoria(c: CatalogoCategoria) {
    setConfirmarCat(null)
    const ld = toastLoading('Eliminando…')
    startDelete(async () => {
      const r = await eliminarCategoria(c.categoria_id)
      await ld.dismiss()
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
  // +1 por la columna de selección (col-check) al inicio de la vista lista, que solo
  // se pinta si el usuario puede editar (la selección en lote es una acción de escritura).
  const colSpanLista = (data.tieneInventario ? 6 : 5) + (puedeEditar ? 1 : 0)

  // ── Selección múltiple (acciones en lote) ──
  // Sobre los ítems VISIBLES (respeta el chip de categoría). Se limpia al cambiar
  // de pestaña o de filtro para no arrastrar contexto oculto.
  const itemsVisibles = useMemo(() => gruposFiltrados.flatMap(g => g.items), [gruposFiltrados])
  const itemIds = useMemo(() => itemsVisibles.map(i => i.item_id), [itemsVisibles])
  const sel = useRowSelection(itemIds)
  useEffect(() => { sel.clear() }, [tab, filtroCategoria]) // eslint-disable-line react-hooks/exhaustive-deps

  const itemsSel     = itemsVisibles.filter(i => sel.isSelected(i.item_id))
  const hayDisponibles = itemsSel.some(i => i.disponible)
  const hayAgotados    = itemsSel.some(i => !i.disponible)

  function ejecutarLote(fn: () => Promise<ResultadoLoteCatalogo>, mensaje: (n: number) => string, cargando: string) {
    const ld = toastLoading(cargando)
    startBulk(async () => {
      const r = await fn()
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess(mensaje(r.hechas))
      sel.clear()
      onSaved()
    })
  }
  const plural = (n: number) => n === 1 ? '' : 's'
  function doEliminarLote() {
    setConfirmarLote(false)
    ejecutarLote(() => eliminarItemsEnLote(sel.selectedIds), n => `${n} ${artL}${plural(n)} eliminado${plural(n)}.`, 'Eliminando…')
  }

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
          <div className="tes-header-actions">
            <ExportarMenu
              clave="catalogo_items"
              filtro={{ categoria: filtroCategoria === 'todas' ? '' : filtroCategoria }}
              resumen={[filtroCategoria !== 'todas'
                ? (data.categorias.find(c => c.categoria_id === filtroCategoria)?.nombre ?? '')
                : ''].filter((x): x is string => Boolean(x))}
            />
            {puedeEditar && (
              <button className="btn btn-primary" onClick={() => setModalItem('nuevo')}>
                <Plus size={16} strokeWidth={2} /> {art}
              </button>
            )}
          </div>
        )}
        {tab === 'categorias' && puedeEditar && (
          <button className="btn btn-primary" onClick={() => setModalCategoria('nueva')}>
            <Plus size={16} strokeWidth={2} /> Categoría
          </button>
        )}
      </div>
      {children}

      <Tabs
        ariaLabel="Secciones del catálogo"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'items', label: 'Ítems', count: data.items.length },
          { id: 'categorias', label: 'Categorías', count: data.categorias.length },
          { id: 'configuracion', label: 'Configuración y QR' },
        ]}
      />

      {tab === 'items' && (
        <>
          {data.categorias.length > 0 && (
            <div className="cat-items-toolbar">
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
            </div>
          )}

          {!hayItems ? (
            <div className="card cat-empty">
              <Package size={32} strokeWidth={1.5} />
              <p>Aún no has añadido {artsL} a tu {data.etiquetas.catalogo.toLowerCase()}.</p>
              {puedeEditar && (
                <button className="btn btn-primary" onClick={() => setModalItem('nuevo')}>
                  <Plus size={16} strokeWidth={2} /> Añadir el primero
                </button>
              )}
            </div>
          ) : (
            <div className="card card-table">
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      {puedeEditar && (
                        <th className="col-check">
                          <HeaderCheck checked={sel.allSelected} indeterminate={sel.someSelected} onChange={sel.toggleAll} />
                        </th>
                      )}
                      <th></th>
                      <th>{art}</th>
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
                        {g.items.map((item, idx) => (
                          <ItemRow key={item.item_id} item={item} tieneInventario={data.tieneInventario} articulo={art}
                            puedeEditar={puedeEditar}
                            selected={sel.isSelected(item.item_id)} onToggle={() => sel.toggle(item.item_id)}
                            canUp={idx > 0} canDown={idx < g.items.length - 1} reordenando={isReordenando}
                            onMoveUp={() => reordenar(g.items.map(i => i.item_id), idx, -1, reordenarItems)}
                            onMoveDown={() => reordenar(g.items.map(i => i.item_id), idx, 1, reordenarItems)}
                            onEdit={() => setModalItem(item)} onDuplicate={() => doDuplicar(item)}
                            onDelete={() => setConfirmarItem(item)} onSaved={onSaved} />
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
          articulo={art}
          puedeEditar={puedeEditar}
          reordenando={isReordenando}
          onMover={(ids, index, dir) => reordenar(ids, index, dir, reordenarCategorias)}
          onNueva={() => setModalCategoria('nueva')}
          onEditar={c => setModalCategoria(c)}
          onEliminar={c => setConfirmarCat(c)}
        />
      )}

      {tab === 'configuracion' && (
        <ConfiguracionTab data={data} puedeEditar={puedeEditar} onSaved={onSaved} />
      )}

      {tab === 'items' && puedeEditar && (
        <BulkBar count={sel.count} onClear={sel.clear}>
          {hayAgotados && (
            <button className="btn btn-secondary btn-sm" disabled={isBulk}
              onClick={() => ejecutarLote(
                () => marcarDisponibleEnLote(sel.selectedIds, true),
                n => `${n} ${artL}${plural(n)} marcado${plural(n)} como disponible${plural(n)}.`, 'Actualizando…')}>
              <Eye size={14} strokeWidth={2} /> Marcar disponible
            </button>
          )}
          {hayDisponibles && (
            <button className="btn btn-secondary btn-sm" disabled={isBulk}
              onClick={() => ejecutarLote(
                () => marcarDisponibleEnLote(sel.selectedIds, false),
                n => `${n} ${artL}${plural(n)} marcado${plural(n)} como agotado${plural(n)}.`, 'Actualizando…')}>
              <EyeOff size={14} strokeWidth={2} /> Marcar agotado
            </button>
          )}
          <button className="btn btn-danger-text btn-sm" disabled={isBulk}
            onClick={() => setConfirmarLote(true)}>
            <Trash2 size={14} strokeWidth={2} /> Eliminar
          </button>
        </BulkBar>
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
          esComida={esComida}
          articulo={art}
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

      {confirmarLote && (
        <ConfirmDialog
          title={`¿Eliminar ${sel.count} ${artL}${plural(sel.count)}?`}
          body={`Se quitará${plural(sel.count) ? 'n' : ''} de tu ${data.etiquetas.catalogo.toLowerCase()}. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmarLote(false)}
          onConfirm={doEliminarLote}
        />
      )}
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
      {sufijoPeriodo(item.periodicidad)}
    </span>
  )
}

// ── Fila de ítem (vista lista) ───────────────────────────────────────────────

function ItemRow({ item, tieneInventario, articulo, puedeEditar, selected, onToggle, canUp, canDown, reordenando, onMoveUp, onMoveDown, onEdit, onDuplicate, onDelete, onSaved }: {
  item: CatalogoItem; tieneInventario: boolean; articulo: string; puedeEditar: boolean; selected: boolean; onToggle: () => void
  canUp: boolean; canDown: boolean; reordenando: boolean; onMoveUp: () => void; onMoveDown: () => void
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void; onSaved: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function toggleDisponible() {
    const ld = toastLoading('Actualizando…')
    startTransition(async () => {
      const r = await marcarDisponible(item.item_id, !item.disponible)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <tr className={`table-row-clickable ${!item.disponible ? 'cat-row-agotado' : ''}`}
      onClick={() => router.push(`/portal/catalogo/${item.item_id}`)}>
      {puedeEditar && (
        <td className="col-check" onClick={e => e.stopPropagation()}>
          <input type="checkbox" className="row-check" checked={selected}
            onChange={onToggle} aria-label={`Seleccionar ${item.nombre}`} />
        </td>
      )}
      <td data-label="" className="cat-row-thumb-cell">
        <span className="cat-row-thumb">
          {item.foto_thumb_url
            ? <span className="cat-row-thumb-img" style={{ '--preview': `url(${item.foto_thumb_url})` } as React.CSSProperties} />
            : <Package size={18} strokeWidth={1.5} />}
        </span>
      </td>
      <td data-label={articulo}><strong className="cell-clamp">{item.nombre}</strong></td>
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
          {puedeEditar && (<>
            <button className="row-actions-item" onClick={onEdit}><Pencil size={15} strokeWidth={2} /> Editar</button>
            <button className="row-actions-item" onClick={onDuplicate} disabled={isPending}><Copy size={15} strokeWidth={2} /> Duplicar</button>
            <button className="row-actions-item" onClick={onMoveUp} disabled={!canUp || reordenando}><ChevronUp size={15} strokeWidth={2} /> Subir</button>
            <button className="row-actions-item" onClick={onMoveDown} disabled={!canDown || reordenando}><ChevronDown size={15} strokeWidth={2} /> Bajar</button>
            <button className="row-actions-item" onClick={toggleDisponible} disabled={isPending}>
              {item.disponible ? <><EyeOff size={15} strokeWidth={2} /> Marcar agotado</> : <><Eye size={15} strokeWidth={2} /> Marcar disponible</>}
            </button>
            <button className="row-actions-item row-actions-item-danger" onClick={onDelete} disabled={isPending}>
              <Trash2 size={14} strokeWidth={2} /> Eliminar
            </button>
          </>)}
        </RowActions>
      </td>
    </tr>
  )
}

// ── Tab: Categorías ──────────────────────────────────────────────────────────

function CategoriasTab({ categorias, items, articulo, puedeEditar, reordenando, onMover, onNueva, onEditar, onEliminar }: {
  categorias: CatalogoCategoria[]
  items: CatalogoItem[]
  articulo: string
  puedeEditar: boolean
  reordenando: boolean
  onMover: (ids: string[], index: number, dir: -1 | 1) => void
  onNueva: () => void
  onEditar: (c: CatalogoCategoria) => void
  onEliminar: (c: CatalogoCategoria) => void
}) {
  const arts = `${articulo}s`         // plural para cabecera/etiqueta («Artículos»)
  const artsL = arts.toLowerCase()
  const catIds = categorias.map(c => c.categoria_id)
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
        <p>Aún no tienes categorías. Agrúpalas para que tus clientes encuentren los {artsL} más rápido.</p>
        {puedeEditar && (
          <button className="btn btn-primary" onClick={onNueva}>
            <Plus size={16} strokeWidth={2} /> Nueva categoría
          </button>
        )}
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
              <th className="col-num">{arts}</th>
              <th className="col-num">Descuento</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {categorias.map((c, idx) => (
              <tr key={c.categoria_id} className={puedeEditar ? 'table-row-clickable' : undefined}
                onClick={puedeEditar ? () => onEditar(c) : undefined}>
                <td data-label="Categoría"><strong className="cell-clamp">{c.nombre}</strong></td>
                <td data-label={arts} className="col-num">{conteo.get(c.categoria_id) ?? 0}</td>
                <td data-label="Descuento" className="col-num">{c.descuento_pct > 0 ? `-${c.descuento_pct}%` : '—'}</td>
                <td className="col-actions">
                  {puedeEditar && (
                    <RowActions>
                      <button className="row-actions-item" onClick={() => onEditar(c)}><Pencil size={15} strokeWidth={2} /> Editar</button>
                      <button className="row-actions-item" onClick={() => onMover(catIds, idx, -1)} disabled={idx === 0 || reordenando}><ChevronUp size={15} strokeWidth={2} /> Subir</button>
                      <button className="row-actions-item" onClick={() => onMover(catIds, idx, 1)} disabled={idx === categorias.length - 1 || reordenando}><ChevronDown size={15} strokeWidth={2} /> Bajar</button>
                      <button className="row-actions-item row-actions-item-danger" onClick={() => onEliminar(c)}><Trash2 size={14} strokeWidth={2} /> Eliminar</button>
                    </RowActions>
                  )}
                </td>
              </tr>
            ))}
            {sinCategoria > 0 && (
              <tr>
                <td data-label="Categoría"><span className="cat-cat-sin">Sin categoría</span></td>
                <td data-label={arts} className="col-num">{sinCategoria}</td>
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
              <div className="form-label-with-help">
                <label htmlFor="cat-descuento">Descuento de la categoría (%)</label>
                <FormHelp text="Se aplica a todos los productos del grupo que no tengan su propio descuento." label="Cómo se aplica el descuento de categoría" />
              </div>
              <input id="cat-descuento" name="descuento_pct" type="number" min="0" max="100" step="any"
                className="input" defaultValue={categoria?.descuento_pct ? categoria.descuento_pct : ''} placeholder="0" />
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

function ConfiguracionTab({ data, puedeEditar, onSaved }: { data: CatalogoData; puedeEditar: boolean; onSaved: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [isImporting, startImport] = useTransition()
  const [tipoImport, setTipoImport] = useState<TipoImportacion>('AMBOS')
  const [isSavingMoneda, startMoneda] = useTransition()
  const [slugInput, setSlugInput] = useState(data.slug ?? '')

  const origen = typeof window !== 'undefined' ? window.location.origin : ''
  // Segmento de URL acorde al negocio: /menu, /carta, /servicios o /catalogo
  // (deriva de la etiqueta). Debe coincidir con los rewrites de next.config; para
  // cualquier etiqueta fuera de ese conjunto, cae a /catalogo (ruta física).
  const vistaRaw = data.etiquetas.catalogo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const segmentoVista = ['menu', 'carta', 'servicios', 'catalogo'].includes(vistaRaw) ? vistaRaw : 'catalogo'
  const url = data.slug ? `${origen}/${data.slug}/${segmentoVista}` : null

  function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const r = await guardarSlug(fd)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess('Enlace guardado.')
      onSaved()
    })
  }

  function copiarEnlace() {
    if (!url) return
    navigator.clipboard.writeText(url).then(() => toastSuccess('Enlace copiado.'))
  }

  function importar() {
    const ld = toastLoading('Importando…')
    startImport(async () => {
      const r = await importarDesdeProductos(tipoImport)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess(r.creados ? `${r.creados} ítem(s) importado(s).` : 'No hay nada nuevo que importar.')
      onSaved()
    })
  }

  function cambiarMoneda(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    // Transición propia: no debe activar el spinner del botón "Guardar" del enlace.
    const ld = toastLoading('Actualizando…')
    startMoneda(async () => {
      const r = await guardarMonedaCatalogo(val)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      toastSuccess(`Moneda del ${data.etiquetas.catalogo.toLowerCase()} actualizada.`)
      onSaved()
    })
  }

  return (
    <div className="cat-config-grid">
      {puedeEditar && (
      <div className="card">
        <div className="card-header"><h2 className="card-title">Moneda del {data.etiquetas.catalogo.toLowerCase()}</h2></div>
        <div className="input-group">
          <div className="form-label-with-help">
            <label htmlFor="cat-moneda" className="cat-moneda-label">
              Los precios se muestran en esta moneda
              {isSavingMoneda && <span className="cat-moneda-loading"><Loader2 size={13} strokeWidth={2} className="img-upload-spin" /> Actualizando…</span>}
            </label>
            <FormHelp text={`Cada producto guarda su precio en su moneda; tu ${data.etiquetas.catalogo.toLowerCase()} los convierte a esta según la tasa de cambio vigente (Monedas y tasas). No cambia tu enlace público.`} label="Cómo se convierten los precios" />
          </div>
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
      </div>
      )}

      <div className="card">
        <div className="card-header"><h2 className="card-title">Enlace público</h2></div>
        {puedeEditar && (
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
        )}

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

      {/* El QR vive en `QrEnlace` desde que Reservas y Citas también lo necesitan. */}
      <QrEnlace url={url} nombreArchivo={`qr-${data.slug ?? 'catalogo'}`} />

      {data.puedeImportar && puedeEditar && (
        <div className="card">
          <div className="card-header"><h2 className="card-title">Importar de tu lista</h2></div>
          <p className="input-hint">
            Trae lo que ya tienes dado de alta como ítems del catálogo (no duplica lo ya vinculado).
          </p>
          {/* Elegir qué se trae: una peluquería querrá publicar sus tratamientos y no
              los tintes que gasta por dentro; una tienda, justo lo contrario. Sin
              Inventario no hay físicos que separar, así que el selector no aplica.
              En desktop el selector y el botón van en línea (misma fila, con aire);
              en móvil la fila envuelve y quedan apilados. */}
          <div className="cat-form-row-inline">
            {data.tieneInventario && (
              <div className="input-group cat-input-grow">
                <label htmlFor="cat-tipo-import">Qué importar</label>
                <select className="input" id="cat-tipo-import" value={tipoImport}
                  onChange={e => setTipoImport(e.target.value as TipoImportacion)}>
                  <option value="AMBOS">Servicios y productos</option>
                  <option value="SERVICIO">Solo servicios</option>
                  <option value="PRODUCTO">Solo productos físicos</option>
                </select>
              </div>
            )}
            <button type="button" className="btn btn-secondary" onClick={importar} disabled={isImporting}>
              {isImporting ? <Loader2 size={16} strokeWidth={2} className="img-upload-spin" /> : <Package size={16} strokeWidth={2} />}
              Importar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
