'use client'

import { useState, useTransition } from 'react'
import Link                         from 'next/link'
import { useRouter }                from 'next/navigation'
import {
  archivarProducto,
  restaurarProducto,
  ajustarStock,
  type ProductoDetalleData,
  type Producto,
} from '@/app/actions/portal/productos'
import { ProductoFormModal } from '../_ProductoFormModal'

// ── Helpers de formato ────────────────────────────────────────────────────────

function fmt(n: number, moneda: string) {
  return new Intl.NumberFormat('es-VE', {
    style:    'currency',
    currency: moneda,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-VE', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── Componente Tab ────────────────────────────────────────────────────────────

function Tab({ active, onClick, label, badge }: {
  active:  boolean
  onClick: () => void
  label:   string
  badge?:  string | number
}) {
  return (
    <button onClick={onClick} className={`detail-tab${active ? ' active' : ''}`}>
      {label}
      {badge !== undefined && (
        <span className="detail-tab-count">{badge}</span>
      )}
    </button>
  )
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
  const { producto, categoria, proveedor } = data
  const esServicio = producto.tipo === 'SERVICIO'

  return (
    <div className="det-tab-body">
      {/* Datos generales */}
      <div className="det-card">
        <div className="det-section-title">Datos generales</div>
        <div className="det-field-grid">
          <Campo label="Nombre"      value={producto.nombre} />
          <Campo label="Código"      value={<code className="text-mono">{producto.codigo}</code>} />
          <Campo label="Tipo"        value={
            <span className={`badge ${esServicio ? 'badge-purple' : 'badge-info'}`}>
              {esServicio ? 'Servicio' : 'Producto'}
            </span>
          } />
          <Campo label="Estado"      value={
            <span className={`badge ${producto.estado === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
              {producto.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
            </span>
          } />
          <Campo label="Unidad"      value={producto.unidad} />
          <Campo label="Categoría"   value={categoria?.nombre} />
          <Campo label="Proveedor"   value={proveedor ? (
            <Link href={`/portal/terceros/${proveedor.tercero_id}`} className="link-primary">
              {proveedor.nombre}
            </Link>
          ) : null} />
          <Campo label="Cód. proveedor" value={producto.codigo_proveedor} />
        </div>
        {producto.descripcion && (
          <div className="mt-5">
            <div className="det-label">Descripción</div>
            <div className="det-value det-value-pre">{producto.descripcion}</div>
          </div>
        )}
      </div>

      {/* Stock (solo productos) */}
      {!esServicio && (
        <div className="det-card">
          <div className="det-section-title">Inventario</div>
          <div className="det-field-grid-sm">
            <div>
              <div className="det-label">Stock actual</div>
              <div
                className="det-stock-num"
                style={{ color: producto.stock_actual <= producto.stock_minimo && producto.stock_minimo > 0
                  ? 'var(--color-error)' : 'var(--color-text)' }}
              >
                {producto.stock_actual.toLocaleString('es-VE')}
                <span className="det-stock-unit">{producto.unidad}</span>
              </div>
              {producto.stock_actual <= producto.stock_minimo && producto.stock_minimo > 0 && (
                <div className="det-stock-alert">
                  <IconAlertTriangle /> Stock por debajo del mínimo
                </div>
              )}
            </div>
            <Campo label="Stock mínimo" value={`${producto.stock_minimo.toLocaleString('es-VE')} ${producto.unidad}`} />
          </div>
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
        <div className="overflow-x-auto">
          <table className="prd-prices-table">
            <thead>
              <tr>
                <th>Moneda</th>
                <th className="text-align-right">Precio de venta</th>
                <th className="text-align-right">Costo</th>
                <th className="text-align-right">Margen</th>
              </tr>
            </thead>
            <tbody>
              {allMonedas.map((mon) => {
                const precio = producto.precios[mon] ?? 0
                const costo  = producto.costos[mon]  ?? 0
                const margen = precio > 0 && costo > 0
                  ? ((precio - costo) / precio * 100).toFixed(1)
                  : null

                return (
                  <tr key={mon}>
                    <td>
                      <span className="prd-moneda-badge">{mon}</span>
                    </td>
                    <td className="ven-td-amt">
                      {precio > 0 ? fmt(precio, mon) : <span className="text-faint">—</span>}
                    </td>
                    <td className="text-align-right">
                      {costo > 0 ? fmt(costo, mon) : <span className="text-faint">—</span>}
                    </td>
                    <td className="text-align-right">
                      {margen !== null ? (
                        <span
                          className="prd-margen"
                          style={{ color: parseFloat(margen) > 20
                            ? 'var(--color-success)'
                            : parseFloat(margen) > 0
                              ? 'var(--color-warning)'
                              : 'var(--color-error)' }}
                        >
                          {margen}%
                        </span>
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

function TabMovimientos() {
  return (
    <div className="det-empty">
      <div className="det-empty-icon"><IconBoxLg /></div>
      <div className="det-empty-title">Movimientos de inventario</div>
      <div className="det-empty-text">Aquí se mostrarán entradas, salidas y ajustes de este producto.</div>
    </div>
  )
}

// ── Tab: Historial de precios (placeholder) ───────────────────────────────────

function TabHistorialPrecios() {
  return (
    <div className="det-empty">
      <div className="det-empty-icon"><IconTrendingUpLg /></div>
      <div className="det-empty-title">Historial de precios</div>
      <div className="det-empty-text">Aquí se mostrará la evolución de precios y costos en el tiempo.</div>
    </div>
  )
}

// ── Modal de ajuste de stock ──────────────────────────────────────────────────

function StockModal({
  producto,
  onClose,
  onSaved,
}: {
  producto: Producto
  onClose:  () => void
  onSaved:  (nuevoStock: number) => void
}) {
  const [cantidad, setCantidad] = useState('')
  const [motivo,   setMotivo]   = useState('')
  const [error,    setError]    = useState('')
  const [pending,  startT]      = useTransition()

  const cantNum = parseFloat(cantidad) || 0
  const preview = producto.stock_actual + cantNum

  function handleSubmit() {
    if (!cantidad) { setError('Ingresa una cantidad.'); return }
    if (!motivo.trim()) { setError('El motivo es obligatorio.'); return }
    startT(async () => {
      const res = await ajustarStock(producto.producto_id, cantNum, motivo.trim())
      if (!res.ok) { setError(res.error ?? 'Error'); return }
      onSaved(res.stock_nuevo!)
    })
  }

  return (
    <div className="modal-backdrop">
      <div className="prd-stock-modal">
        <h3>Ajustar stock — {producto.nombre}</h3>

        <div className="prd-stock-current">
          <div className="prd-stock-current-label">Stock actual</div>
          <div className="prd-stock-current-val">
            {producto.stock_actual.toLocaleString('es-VE')} {producto.unidad}
          </div>
        </div>

        <div className="prd-stock-group">
          <label>Cantidad (+ entrada / − salida)</label>
          <input
            className="input"
            type="number" value={cantidad} onChange={e => setCantidad(e.target.value)}
            placeholder="ej: 10 o -5"
          />
        </div>

        {cantidad && !isNaN(parseFloat(cantidad)) && (
          <div
            className="prd-stock-preview"
            style={{
              background: preview < 0 ? 'var(--color-error-bg)' : 'var(--color-success-bg)',
              color: preview < 0 ? 'var(--color-error)' : 'var(--color-success)',
            }}
          >
            Stock resultante: {preview.toLocaleString('es-VE')} {producto.unidad}
            {preview < 0 && (
              <span className="prd-stock-preview-inline">
                <IconAlertTriangle /> Stock negativo no permitido
              </span>
            )}
          </div>
        )}

        <div className="prd-stock-group mb-5">
          <label>Motivo del ajuste *</label>
          <input
            className="input"
            type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="ej: Conteo físico, devolución, etc."
          />
        </div>

        {error && (
          <div className="alert alert-error mb-4">{error}</div>
        )}

        <div className="prd-stock-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={pending || preview < 0}
            className="btn btn-primary"
          >
            {pending ? 'Guardando…' : 'Confirmar ajuste'}
          </button>
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

  const { producto } = data
  const esServicio   = producto.tipo === 'SERVICIO'

  function handleSaved(nuevoStock: number) {
    setData(prev => ({
      ...prev,
      producto: { ...prev.producto, stock_actual: nuevoStock },
    }))
    setShowStock(false)
    setStatusMsg('Stock actualizado')
    setTimeout(() => setStatusMsg(''), 3000)
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
        <Link href="/portal/productos">Productos</Link>
        <span>›</span>
        <span className="breadcrumb-current">{producto.nombre}</span>
      </div>

      {/* Header */}
      <div className="det-page-header">
        <div>
          <div className="det-title-group">
            <h1 className="det-page-title">{producto.nombre}</h1>
            <span className={`badge ${esServicio ? 'badge-purple' : 'badge-info'}`}>
              {esServicio ? 'Servicio' : 'Producto'}
            </span>
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
          {!esServicio && producto.estado === 'ACTIVO' && (
            <button onClick={() => setShowStock(true)} className="btn btn-info">
              <IconLayers /> Ajustar stock
            </button>
          )}
          <button onClick={() => setShowEdit(true)} className="btn btn-secondary">
            <IconEdit /> Editar
          </button>
          <button
            onClick={toggleEstado}
            disabled={pending}
            className="btn btn-secondary"
            style={{ color: producto.estado === 'ACTIVO' ? 'var(--color-error)' : 'var(--color-success)' }}
          >
            {producto.estado === 'ACTIVO' ? <><IconArchive /> Archivar</> : <><IconRestore /> Restaurar</>}
          </button>
        </div>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div className="alert alert-success mb-4">{statusMsg}</div>
      )}

      {/* Tabs */}
      <div className="detail-tabs">
        <Tab active={tab === 'info'}        onClick={() => setTab('info')}        label="Información" />
        <Tab active={tab === 'precios'}     onClick={() => setTab('precios')}     label="Precios y costos" />
        {!esServicio && (
          <Tab active={tab === 'movimientos'} onClick={() => setTab('movimientos')} label="Movimientos" />
        )}
        <Tab active={tab === 'historial'}   onClick={() => setTab('historial')}   label="Historial de precios" />
      </div>

      {/* Contenido del tab */}
      {tab === 'info'        && <TabInfo     data={data} />}
      {tab === 'precios'     && <TabPrecios  data={data} />}
      {tab === 'movimientos' && <TabMovimientos />}
      {tab === 'historial'   && <TabHistorialPrecios />}

      {/* Modal de ajuste de stock */}
      {showStock && (
        <StockModal
          producto={data.producto}
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

// ── Iconos (Feather, stroke, currentColor) ────────────────────────────────────

function IconEdit()          { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function IconArchive()       { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> }
function IconRestore()       { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg> }
function IconLayers()        { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> }
function IconAlertTriangle() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> }
function IconBoxLg()         { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" opacity="0.2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> }
function IconTrendingUpLg()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" opacity="0.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> }
