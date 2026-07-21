'use client'

import { useState, useTransition, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link                         from 'next/link'
import { useRouter }                from 'next/navigation'
import {
  archivarProducto,
  restaurarProducto,
  type ProductoDetalleData,
  type MovimientoProducto,
} from '@/app/actions/portal/productos'
import { ProductoFormModal } from '../_ProductoFormModal'
import { StockAjusteModal } from '../_StockAjusteModal'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { RowActions } from '@/components/portal/RowActions'
import Tabs, { type TabItem } from '@/components/Tabs'
import { AlertTriangle, Archive, Layers, Package, Pencil, RotateCcw, TrendingUp } from 'lucide-react'

// ── Config de movimientos ───────────────────────────────────────────────────────

const MOV_TIPO_LABEL: Record<MovimientoProducto['tipo'], string> = {
  ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste', TRANSFERENCIA: 'Transferencia',
}
const MOV_TIPO_BADGE: Record<MovimientoProducto['tipo'], string> = {
  ENTRADA: 'badge-success', SALIDA: 'badge-warning', AJUSTE: 'badge-info', TRANSFERENCIA: 'badge-purple',
}
function signoMov(m: MovimientoProducto): { txt: string; cls: string } {
  const n = Math.abs(m.cantidad).toLocaleString('es-ES')
  if (m.tipo === 'ENTRADA') return { txt: `+${n}`, cls: 'mov-cant-pos' }
  if (m.tipo === 'SALIDA')  return { txt: `−${n}`, cls: 'mov-cant-neg' }
  if (m.tipo === 'AJUSTE')  return { txt: m.cantidad >= 0 ? `+${n}` : `−${n}`, cls: m.cantidad >= 0 ? 'mov-cant-pos' : 'mov-cant-neg' }
  return { txt: n, cls: 'mov-cant-neutral' }
}

// ── Helpers de formato ────────────────────────────────────────────────────────

function fmt(n: number, moneda: string) {
  return new Intl.NumberFormat('es-ES', {
    style:    'currency',
    currency: moneda,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── Campos info ───────────────────────────────────────────────────────────────

function Campo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="det-label">{label}</div>
      <div className="det-value">{value ?? <span className="text-faint">—</span>}</div>
    </div>
  )
}

// ── Tab: Información ──────────────────────────────────────────────────────────

function TabInfo({ data }: { data: ProductoDetalleData }) {
  const { producto, categoria, proveedor, stock_por_almacen } = data
  const esServicio = producto.tipo === 'SERVICIO'
  const stockBajo  = producto.stock_actual <= producto.stock_minimo && producto.stock_minimo > 0
  // Sin Inventario no hay existencias que enseñar, ni tipo que distinguir.
  const inv        = data.tieneInventario

  return (
    <div className="det-tab-body">
      {/* Datos generales */}
      <div className="det-card">
        <div className="det-section-title">Datos generales</div>
        <div className="det-field-grid">
          <Campo label="Nombre"      value={producto.nombre} />
          <Campo label="Código"      value={<code className="text-mono">{producto.codigo}</code>} />
          {inv && <Campo label="Tipo" value={
            <span className={`badge ${esServicio ? 'badge-purple' : 'badge-info'}`}>
              {esServicio ? 'Servicio' : 'Producto'}
            </span>
          } />}
          <Campo label="Estado"      value={
            <span className={`badge ${producto.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
              {producto.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
            </span>
          } />
          {!esServicio && <Campo label="Unidad" value={producto.unidad} />}
          <Campo label="Categoría"   value={categoria?.nombre} />
          <Campo label="Proveedor"   value={proveedor ? (
            <Link href={`/portal/terceros/${proveedor.tercero_id}`} className="link-primary">
              {proveedor.nombre}
            </Link>
          ) : null} />
          <Campo label="Cód. proveedor" value={producto.codigo_proveedor} />
          {esServicio && <Campo label="Suscribible" value={producto.es_suscribible ? 'Sí' : 'No'} />}
        </div>
        {producto.descripcion && (
          <div className="mt-5">
            <div className="det-label">Descripción</div>
            <div className="det-value det-value-pre">{producto.descripcion}</div>
          </div>
        )}
      </div>

      {/* Stock (solo productos, y solo con Inventario) */}
      {inv && !esServicio && (
        <div className="det-card">
          <div className="det-section-title">Inventario</div>
          <div className="det-field-grid-sm">
            <div>
              <div className="det-label">Stock total</div>
              <div className={`det-stock-num${stockBajo ? ' det-stock-num-low' : ''}`}>
                {producto.stock_actual.toLocaleString('es-ES')}
                <span className="det-stock-unit">{producto.unidad}</span>
              </div>
              {stockBajo && (
                <div className="det-stock-alert">
                  <AlertTriangle size={13} strokeWidth={2} /> Stock por debajo del mínimo
                </div>
              )}
            </div>
            <Campo label="Stock mínimo" value={`${producto.stock_minimo.toLocaleString('es-ES')} ${producto.unidad}`} />
          </div>

          {stock_por_almacen.length > 0 ? (
            <div className="det-stock-almacenes">
              {stock_por_almacen.map(s => (
                <div key={s.almacen_id} className="det-stock-alm-row">
                  <span>{s.nombre}</span>
                  <strong>{s.cantidad.toLocaleString('es-ES')} {producto.unidad}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs-hint mt-2">Sin stock asignado a almacenes todavía. Usa «Ajustar stock» o confirma una compra.</div>
          )}
        </div>
      )}

      {/* Metadatos */}
      <div className="det-card">
        <div className="det-section-title">Registro</div>
        <div className="det-field-grid">
          <Campo label="Creado"       value={fmtDate(producto.created_at)} />
          <Campo label="Actualizado"  value={fmtDate(producto.updated_at)} />
          <Campo label="ID interno"   value={<code className="code-id">{producto.producto_id}</code>} />
        </div>
      </div>
    </div>
  )
}

// ── Tab: Precios y costos ─────────────────────────────────────────────────────

function TabPrecios({ data }: { data: ProductoDetalleData }) {
  const { producto, monedas } = data

  const allMonedas = Array.from(new Set([
    ...monedas,
    ...Object.keys(producto.precios),
    ...Object.keys(producto.costos),
  ]))

  return (
    <div className="det-tab-body">
      <div className="det-card">
        <div className="det-section-title">Tabla de precios y costos</div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Moneda</th>
                <th className="col-num">Precio de venta</th>
                <th className="col-num">Costo</th>
                <th className="col-num">Margen</th>
              </tr>
            </thead>
            <tbody>
              {allMonedas.map((mon) => {
                const precio = producto.precios[mon] ?? 0
                const costo  = producto.costos[mon]  ?? 0
                const margenNum = precio > 0 && costo > 0 ? (precio - costo) / precio * 100 : null
                const margenCls = margenNum === null ? '' : margenNum > 20 ? 'prd-margen-alto' : margenNum > 0 ? 'prd-margen-bajo' : 'prd-margen-neg'

                return (
                  <tr key={mon}>
                    <td data-label="Moneda">
                      <span className="prd-moneda-badge">{mon}</span>
                    </td>
                    <td data-label="Precio de venta" className="col-num">
                      {precio > 0 ? fmt(precio, mon) : <span className="text-faint">—</span>}
                    </td>
                    <td data-label="Costo" className="col-num">
                      {costo > 0 ? fmt(costo, mon) : <span className="text-faint">—</span>}
                    </td>
                    <td data-label="Margen" className="col-num">
                      {margenNum !== null ? (
                        <span className={`prd-margen ${margenCls}`}>{margenNum.toFixed(1)}%</span>
                      ) : <span className="text-faint">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Movimientos (placeholder) ────────────────────────────────────────────

function TabMovimientos({ data }: { data: ProductoDetalleData }) {
  const { movimientos, almacen_nombres, producto } = data
  const { pageItems, ...pag } = usePagination(movimientos)

  if (movimientos.length === 0) {
    return (
      <div className="det-empty">
        <div className="det-empty-icon"><Package size={40} strokeWidth={1} opacity={0.2} /></div>
        <div className="det-empty-title">Sin movimientos</div>
        <div className="det-empty-text">Aquí se mostrarán entradas, salidas, ajustes y transferencias de este producto.</div>
      </div>
    )
  }

  return (
    <div className="det-tab-body">
      <div className="det-card">
        <div className="det-section-title">Movimientos</div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Almacén</th>
                <th className="col-num">Cantidad</th>
                <th>Motivo</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(m => {
                const s = signoMov(m)
                return (
                  <tr key={m.movimiento_id}>
                    <td data-label="Fecha" className="text-sm-muted">{fmtDate(m.fecha)}</td>
                    <td data-label="Tipo"><span className={`badge ${MOV_TIPO_BADGE[m.tipo]}`}>{MOV_TIPO_LABEL[m.tipo]}</span></td>
                    <td data-label="Almacén" className="text-sm-muted">
                      {m.tipo === 'TRANSFERENCIA' && m.almacen_destino_id
                        ? `${almacen_nombres[m.almacen_id] ?? m.almacen_id} → ${almacen_nombres[m.almacen_destino_id] ?? m.almacen_destino_id}`
                        : (almacen_nombres[m.almacen_id] ?? m.almacen_id)}
                    </td>
                    <td data-label="Cantidad" className={`col-num ${s.cls}`}>{s.txt} {producto.unidad}</td>
                    <td data-label="Motivo" className="text-sm-muted">{m.motivo ?? '—'}</td>
                    <td data-label="Origen">
                      {m.origen === 'MANUAL'
                        ? <span className="text-xs-muted">Manual</span>
                        : <span className="badge badge-neutral">{m.origen === 'COMPRA' ? 'Compra' : 'Venta'}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <TablePagination {...pag} label="movimiento" />
      </div>
    </div>
  )
}

// ── Tab: Historial de precios ──────────────────────────────────────────────────

const HistorialPreciosChart = dynamic(() => import('./HistorialPreciosChart'), { ssr: false })

function TabHistorialPrecios({ data }: { data: ProductoDetalleData }) {
  const { historialPrecios } = data

  // Agrupar por moneda (el historial ya viene ordenado del más reciente al más antiguo)
  const porMoneda = useMemo(() => {
    const m = new Map<string, typeof historialPrecios>()
    for (const h of historialPrecios) {
      const arr = m.get(h.moneda) ?? []
      arr.push(h)
      m.set(h.moneda, arr)
    }
    return m
  }, [historialPrecios])

  const monedas = [...porMoneda.keys()]
  const [monedaSel, setMonedaSel] = useState(monedas[0] ?? '')

  if (historialPrecios.length === 0) {
    return (
      <div className="det-empty">
        <div className="det-empty-icon"><TrendingUp size={40} strokeWidth={1} opacity={0.2} /></div>
        <div className="det-empty-title">Historial de precios</div>
        <div className="det-empty-text">Aún no hay cambios registrados. El historial se genera al modificar precios o costos.</div>
      </div>
    )
  }

  const sel   = porMoneda.has(monedaSel) ? monedaSel : monedas[0]
  const items = porMoneda.get(sel) ?? []

  return (
    <div className="det-tab-body">
      <div className="det-card">
        <div className="det-section-head">
          <div className="det-section-title">Historial de precios</div>
          {monedas.length > 1 && (
            <div className="dash-moneda-switch" role="tablist" aria-label="Moneda">
              {monedas.map(m => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={m === sel}
                  className={m === sel ? 'active' : ''}
                  onClick={() => setMonedaSel(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="dash-split">
          <div className="dash-split-main">
            {items.length >= 2 ? (
              <HistorialPreciosChart historial={items} moneda={sel} />
            ) : (
              <p className="text-xs-hint">Se necesitan al menos dos registros para dibujar la evolución.</p>
            )}
          </div>
          <div className="dash-split-side">
            <div className="dash-subtitle"><span>Cambios registrados</span></div>
            {/* Mismo patrón que «Últimas facturas» del dashboard (.dash-list):
                es una lista de eventos junto a un gráfico, no un dataset que se
                ordene o se recorra en columnas. Cada fila es la FOTO del estado
                tras el cambio (precio y costo vigentes), no un delta: null =
                ese producto no tiene ese importe en esta moneda. */}
            <ul className="dash-list">
              {items.map(h => (
                <li key={h.historial_id} className="dash-list-item">
                  <div className="dash-list-main">
                    <span className="dash-list-title">{fmtDate(h.created_at)}</span>
                    {h.costo != null && (
                      <span className="dash-list-meta">Costo {fmt(h.costo, sel)}</span>
                    )}
                  </div>
                  <span className="dash-list-aside">
                    <span className="dash-list-amount">
                      {h.precio != null ? fmt(h.precio, sel) : '—'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

type TabId = 'info' | 'precios' | 'movimientos' | 'historial'

export default function ProductoDetalle({ data: initialData }: { data: ProductoDetalleData }) {
  const [data,        setData]        = useState(initialData)
  const [tab,         setTab]         = useState<TabId>('info')
  const [showEdit,    setShowEdit]    = useState(false)
  const [showStock,   setShowStock]   = useState(false)
  const [statusMsg,   setStatusMsg]   = useState('')
  const [pending,     startT]         = useTransition()
  const router = useRouter()

  // Mantener el estado local sincronizado con los datos refrescados por router.refresh()
  useEffect(() => { setData(initialData) }, [initialData])

  const { producto } = data
  const esServicio   = producto.tipo === 'SERVICIO'
  const inv          = data.tieneInventario
  const basePath     = esServicio ? '/portal/servicios' : '/portal/productos'
  const tituloLista  = esServicio ? `${data.etiquetaServicio}s` : 'Productos'

  const tabs: TabItem<TabId>[] = [
    { id: 'info',    label: 'Información' },
    { id: 'precios', label: 'Precios y costos' },
    // Movimientos exige Inventario Y que sea un físico: sin el módulo no hay ledger
    // que enseñar, y un servicio no mueve existencias ni teniéndolo.
    ...(inv && !esServicio ? [{ id: 'movimientos' as const, label: 'Movimientos' }] : []),
    { id: 'historial', label: 'Historial de precios' },
  ]

  function handleSaved() {
    setShowStock(false)
    setStatusMsg('Stock actualizado')
    setTimeout(() => setStatusMsg(''), 3000)
    router.refresh()
  }

  function toggleEstado() {
    startT(async () => {
      const fn = producto.estado === 'ACTIVO' ? archivarProducto : restaurarProducto
      const res = await fn(producto.producto_id)
      if (!res.ok) { setStatusMsg(res.error ?? 'Error'); return }
      setData(prev => ({
        ...prev,
        producto: { ...prev.producto, estado: prev.producto.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO' },
      }))
      setStatusMsg(producto.estado === 'ACTIVO' ? 'Producto archivado' : 'Producto restaurado')
      setTimeout(() => setStatusMsg(''), 3000)
    })
  }

  return (
    <div className="view-container">

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href={basePath}>{tituloLista}</Link>
        <span>›</span>
        <span className="breadcrumb-current">{producto.nombre}</span>
      </div>

      {/* Header */}
      <div className="det-page-header">
        <div>
          <div className="det-title-group">
            <h1 className="det-page-title">{producto.nombre}</h1>
            {inv && (
              <span className={`badge ${esServicio ? 'badge-purple' : 'badge-info'}`}>
                {esServicio ? 'Servicio' : 'Producto'}
              </span>
            )}
            <span className={`badge ${producto.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
              {producto.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
            </span>
          </div>
          <div className="det-meta-row">
            <code className="code-label">{producto.codigo}</code>
            {producto.codigo_proveedor && (
              <span className="ml-3">Cód. proveedor: <strong>{producto.codigo_proveedor}</strong></span>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div className="det-actions">
          {inv && !esServicio && producto.estado === 'ACTIVO' && (
            <button onClick={() => setShowStock(true)} className="btn btn-primary">
              <Layers size={14} strokeWidth={2} /> Ajustar stock
            </button>
          )}
          <button onClick={() => setShowEdit(true)} className="btn btn-secondary">
            <Pencil size={14} strokeWidth={2} /> Editar
          </button>
          <RowActions>
            <button
              className={`row-actions-item${producto.estado === 'ACTIVO' ? ' row-actions-item-danger' : ''}`}
              onClick={toggleEstado}
              disabled={pending}
            >
              {producto.estado === 'ACTIVO' ? <><Archive size={15} strokeWidth={2} /> Archivar</> : <><RotateCcw size={15} strokeWidth={2} /> Restaurar</>}
            </button>
          </RowActions>
        </div>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div className="alert alert-success mb-4">{statusMsg}</div>
      )}

      {/* Tabs */}
      <Tabs ariaLabel="Secciones del producto" active={tab} onChange={setTab} tabs={tabs} />


      {/* Contenido del tab */}
      {tab === 'info'        && <TabInfo     data={data} />}
      {tab === 'precios'     && <TabPrecios  data={data} />}
      {tab === 'movimientos' && <TabMovimientos data={data} />}
      {tab === 'historial'   && <TabHistorialPrecios data={data} />}

      {/* Modal de ajuste de stock */}
      {showStock && (
        <StockAjusteModal
          producto_id={producto.producto_id}
          nombre={producto.nombre}
          unidad={producto.unidad}
          almacenes={data.almacenes}
          onClose={() => setShowStock(false)}
          onSaved={handleSaved}
        />
      )}

      {/* Modal de edición */}
      {showEdit && (
        <ProductoFormModal
          producto={data.producto}
          categorias={data.categorias}
          proveedores={data.proveedores}
          monedas={data.monedas}
          hayAlmacenes={data.almacenes.length > 0}
          modo={producto.tipo}
          etiquetaServicio={data.etiquetaServicio}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false)
            setStatusMsg('Cambios guardados')
            setTimeout(() => setStatusMsg(''), 3000)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

