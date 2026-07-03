'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useEffect } from 'react'
import Link                         from 'next/link'
import { useRouter }                from 'next/navigation'
import {
  archivarProducto,
  restaurarProducto,
  ajustarStock,
  type ProductoDetalleData,
  type MovimientoProducto,
} from '@/app/actions/portal/productos'
import { ProductoFormModal } from '../_ProductoFormModal'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { AlertTriangle, Archive, Layers, Package, Pencil, RotateCcw, TrendingUp } from 'lucide-react'

// ── Config de movimientos ───────────────────────────────────────────────────────

const MOV_TIPO_LABEL: Record<MovimientoProducto['tipo'], string> = {
  ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste', TRANSFERENCIA: 'Transferencia',
}
const MOV_TIPO_BADGE: Record<MovimientoProducto['tipo'], string> = {
  ENTRADA: 'badge-success', SALIDA: 'badge-warning', AJUSTE: 'badge-info', TRANSFERENCIA: 'badge-purple',
}
function signoMov(m: MovimientoProducto): { txt: string; cls: string } {
  const n = Math.abs(m.cantidad).toLocaleString('es-VE')
  if (m.tipo === 'ENTRADA') return { txt: `+${n}`, cls: 'mov-cant-pos' }
  if (m.tipo === 'SALIDA')  return { txt: `−${n}`, cls: 'mov-cant-neg' }
  if (m.tipo === 'AJUSTE')  return { txt: m.cantidad >= 0 ? `+${n}` : `−${n}`, cls: m.cantidad >= 0 ? 'mov-cant-pos' : 'mov-cant-neg' }
  return { txt: n, cls: 'mov-cant-neutral' }
}

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
  const { producto, categoria, proveedor, stock_por_almacen } = data
  const esServicio = producto.tipo === 'SERVICIO'
  const stockBajo  = producto.stock_actual <= producto.stock_minimo && producto.stock_minimo > 0

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
              <div className="det-label">Stock total</div>
              <div className={`det-stock-num${stockBajo ? ' det-stock-num-low' : ''}`}>
                {producto.stock_actual.toLocaleString('es-VE')}
                <span className="det-stock-unit">{producto.unidad}</span>
              </div>
              {stockBajo && (
                <div className="det-stock-alert">
                  <AlertTriangle size={13} strokeWidth={2} /> Stock por debajo del mínimo
                </div>
              )}
            </div>
            <Campo label="Stock mínimo" value={`${producto.stock_minimo.toLocaleString('es-VE')} ${producto.unidad}`} />
          </div>

          {stock_por_almacen.length > 0 ? (
            <div className="det-stock-almacenes">
              {stock_por_almacen.map(s => (
                <div key={s.almacen_id} className="det-stock-alm-row">
                  <span>{s.nombre}</span>
                  <strong>{s.cantidad.toLocaleString('es-VE')} {producto.unidad}</strong>
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

// ── Tab: Historial de precios (placeholder) ───────────────────────────────────

function TabHistorialPrecios() {
  return (
    <div className="det-empty">
      <div className="det-empty-icon"><TrendingUp size={40} strokeWidth={1} opacity={0.2} /></div>
      <div className="det-empty-title">Historial de precios</div>
      <div className="det-empty-text">Aquí se mostrará la evolución de precios y costos en el tiempo.</div>
    </div>
  )
}

// ── Modal de ajuste de stock ──────────────────────────────────────────────────

function StockModal({
  data,
  onClose,
  onSaved,
}: {
  data:     ProductoDetalleData
  onClose:  () => void
  onSaved:  () => void
}) {
  const { producto, almacenes, stock_por_almacen } = data
  const [almacenId, setAlmacenId] = useState(almacenes[0]?.almacen_id ?? '')
  const [cantidad,  setCantidad]  = useState('')
  const [motivo,    setMotivo]    = useState('')
  const [pending,   startT]       = useTransition()

  const cantNum   = parseFloat(cantidad) || 0
  const actualAlm = stock_por_almacen.find(s => s.almacen_id === almacenId)?.cantidad ?? 0
  const preview   = actualAlm + cantNum

  function handleSubmit() {
    if (!almacenId)     { toastError('Selecciona un almacén.'); return }
    if (!cantidad)      { toastError('Ingresa una cantidad.'); return }
    if (!motivo.trim()) { toastError('El motivo es obligatorio.'); return }
    startT(async () => {
      const res = await ajustarStock(producto.producto_id, almacenId, cantNum, motivo.trim())
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      onSaved()
    })
  }

  if (almacenes.length === 0) {
    return (
      <div className="modal-backdrop">
        <div className="prd-stock-modal">
          <h3>Ajustar stock — {producto.nombre}</h3>
          <p className="modal-body-text">
            Necesitas al menos un almacén para ajustar el stock. Crea uno en <strong>Almacenes</strong>.
          </p>
          <div className="prd-stock-footer">
            <button onClick={onClose} className="btn btn-secondary">Cerrar</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop">
      <div className="prd-stock-modal">
        <h3>Ajustar stock — {producto.nombre}</h3>

        <div className="prd-stock-group">
          <label htmlFor="stk-alm">Almacén</label>
          <select id="stk-alm" className="input" value={almacenId} onChange={e => setAlmacenId(e.target.value)}>
            {almacenes.map(a => <option key={a.almacen_id} value={a.almacen_id}>{a.nombre}</option>)}
          </select>
        </div>

        <div className="prd-stock-current">
          <div className="prd-stock-current-label">Stock actual en este almacén</div>
          <div className="prd-stock-current-val">
            {actualAlm.toLocaleString('es-VE')} {producto.unidad}
          </div>
        </div>

        <div className="prd-stock-group">
          <label htmlFor="stk-cant">Cantidad (+ entrada / − salida)</label>
          <input id="stk-cant" className="input" type="number" step="any"
            value={cantidad} onChange={e => setCantidad(e.target.value)} placeholder="ej: 10 o -5" />
        </div>

        {cantidad && !isNaN(parseFloat(cantidad)) && (
          <div className={`prd-stock-preview ${preview < 0 ? 'prd-stock-preview-neg' : 'prd-stock-preview-ok'}`}>
            Stock resultante: {preview.toLocaleString('es-VE')} {producto.unidad}
            {preview < 0 && (
              <span className="prd-stock-preview-inline">
                <AlertTriangle size={13} strokeWidth={2} /> Stock negativo no permitido
              </span>
            )}
          </div>
        )}

        <div className="prd-stock-group mb-5">
          <label htmlFor="stk-motivo">Motivo del ajuste *</label>
          <input id="stk-motivo" className="input" type="text"
            value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="ej: Conteo físico, devolución, etc." />
        </div>

        <div className="prd-stock-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancelar</button>
          <button onClick={handleSubmit} disabled={pending || preview < 0} className="btn btn-primary">
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

  // Mantener el estado local sincronizado con los datos refrescados por router.refresh()
  useEffect(() => { setData(initialData) }, [initialData])

  const { producto } = data
  const esServicio   = producto.tipo === 'SERVICIO'

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
              <Layers size={14} strokeWidth={2} /> Ajustar stock
            </button>
          )}
          <button onClick={() => setShowEdit(true)} className="btn btn-secondary">
            <Pencil size={14} strokeWidth={2} /> Editar
          </button>
          <button
            onClick={toggleEstado}
            disabled={pending}
            className="btn btn-secondary"
            style={{ color: producto.estado === 'ACTIVO' ? 'var(--color-error)' : 'var(--color-success)' }}
          >
            {producto.estado === 'ACTIVO' ? <><Archive size={14} strokeWidth={2} /> Archivar</> : <><RotateCcw size={14} strokeWidth={2} /> Restaurar</>}
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
      {tab === 'movimientos' && <TabMovimientos data={data} />}
      {tab === 'historial'   && <TabHistorialPrecios />}

      {/* Modal de ajuste de stock */}
      {showStock && (
        <StockModal
          data={data}
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

