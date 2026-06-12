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

// ── Estilos reutilizables ─────────────────────────────────────────────────────

const S = {
  badgeProducto: {
    display: 'inline-flex', alignItems: 'center',
    fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.04em', padding: '2px 10px', borderRadius: '999px',
    background: '#e0f2fe', color: '#0369a1',
  },
  badgeServicio: {
    display: 'inline-flex', alignItems: 'center',
    fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.04em', padding: '2px 10px', borderRadius: '999px',
    background: '#f3e8ff', color: '#7c3aed',
  },
  badgeActivo: {
    display: 'inline-flex', alignItems: 'center',
    fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.04em', padding: '2px 10px', borderRadius: '999px',
    background: '#dcfce7', color: '#16a34a',
  },
  badgeInactivo: {
    display: 'inline-flex', alignItems: 'center',
    fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.04em', padding: '2px 10px', borderRadius: '999px',
    background: '#f1f5f9', color: '#64748b',
  },
  card: {
    background: 'var(--color-surface, #fff)',
    border:     '1px solid var(--color-border, #e2e8f0)',
    borderRadius: '12px',
    padding:    '20px',
    marginBottom: '16px',
  },
  label: {
    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const,
    letterSpacing: '0.06em', color: 'var(--color-text-muted, #64748b)',
    marginBottom: '4px',
  },
  value: {
    fontSize: '14px', color: 'var(--color-text, #1e293b)',
  },
  sectionTitle: {
    fontSize: '13px', fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.06em', color: 'var(--color-text-muted, #64748b)',
    marginBottom: '16px', paddingBottom: '8px',
    borderBottom: '1px solid var(--color-border, #e2e8f0)',
  },
}

// ── Componente Tab ────────────────────────────────────────────────────────────

function Tab({ active, onClick, label, badge }: {
  active:  boolean
  onClick: () => void
  label:   string
  badge?:  string | number
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '10px 18px',
        fontSize: '13px', fontWeight: active ? 700 : 500,
        color:   active ? 'var(--color-primary, #0ea5e9)' : 'var(--color-text-muted, #64748b)',
        borderTop: 'none', borderLeft: 'none', borderRight: 'none',
        borderBottom: active ? '2px solid var(--color-primary, #0ea5e9)' : '2px solid transparent',
        background: 'transparent', borderRadius: '0',
        cursor: 'pointer', transition: 'color 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      {badge !== undefined && (
        <span style={{
          fontSize: '10px', fontWeight: 700, padding: '1px 6px',
          borderRadius: '999px',
          background: active ? 'var(--color-primary, #0ea5e9)' : '#e2e8f0',
          color: active ? '#fff' : '#64748b',
        }}>
          {badge}
        </span>
      )}
    </button>
  )
}

// ── Campos info (grid de 2 col) ───────────────────────────────────────────────

function Campo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={S.label}>{label}</div>
      <div style={S.value}>{value ?? <span style={{ color: '#cbd5e1' }}>—</span>}</div>
    </div>
  )
}

// ── Tab: Información ──────────────────────────────────────────────────────────

function TabInfo({ data }: { data: ProductoDetalleData }) {
  const { producto, categoria, proveedor } = data
  const esServicio = producto.tipo === 'SERVICIO'

  return (
    <div style={{ padding: '24px 0' }}>
      {/* Datos generales */}
      <div style={S.card}>
        <div style={S.sectionTitle}>Datos generales</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '20px' }}>
          <Campo label="Nombre"      value={producto.nombre} />
          <Campo label="Código"      value={<code style={{ fontFamily: 'monospace', color: 'var(--color-text, #1e293b)' }}>{producto.codigo}</code>} />
          <Campo label="Tipo"        value={
            <span style={esServicio ? S.badgeServicio : S.badgeProducto}>
              {esServicio ? 'Servicio' : 'Producto'}
            </span>
          } />
          <Campo label="Estado"      value={
            <span style={producto.estado === 'ACTIVO' ? S.badgeActivo : S.badgeInactivo}>
              {producto.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
            </span>
          } />
          <Campo label="Unidad"      value={producto.unidad} />
          <Campo label="Categoría"   value={categoria?.nombre} />
          <Campo label="Proveedor"   value={proveedor ? (
            <Link
              href={`/portal/terceros/${proveedor.tercero_id}`}
              style={{ color: 'var(--color-primary, #0ea5e9)', textDecoration: 'none' }}
            >
              {proveedor.nombre}
            </Link>
          ) : null} />
          <Campo label="Cód. proveedor" value={producto.codigo_proveedor} />
        </div>
        {producto.descripcion && (
          <div style={{ marginTop: '20px' }}>
            <div style={S.label}>Descripción</div>
            <div style={{ ...S.value, lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{producto.descripcion}</div>
          </div>
        )}
      </div>

      {/* Stock (solo productos) */}
      {!esServicio && (
        <div style={S.card}>
          <div style={S.sectionTitle}>Inventario</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '20px' }}>
            <div>
              <div style={S.label}>Stock actual</div>
              <div style={{
                fontSize: '28px', fontWeight: 800,
                color: producto.stock_actual <= producto.stock_minimo && producto.stock_minimo > 0
                  ? '#dc2626' : 'var(--color-text, #1e293b)',
              }}>
                {producto.stock_actual.toLocaleString('es-VE')}
                <span style={{ fontSize: '14px', fontWeight: 500, marginLeft: '6px', color: '#64748b' }}>
                  {producto.unidad}
                </span>
              </div>
              {producto.stock_actual <= producto.stock_minimo && producto.stock_minimo > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#dc2626', marginTop: '4px' }}>
                  <IconAlertTriangle /> Stock por debajo del mínimo
                </div>
              )}
            </div>
            <Campo label="Stock mínimo" value={`${producto.stock_minimo.toLocaleString('es-VE')} ${producto.unidad}`} />
          </div>
        </div>
      )}

      {/* Metadatos */}
      <div style={S.card}>
        <div style={S.sectionTitle}>Registro</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '20px' }}>
          <Campo label="Creado"       value={fmtDate(producto.created_at)} />
          <Campo label="Actualizado"  value={fmtDate(producto.updated_at)} />
          <Campo label="ID interno"   value={<code style={{ fontFamily: 'monospace', fontSize: '12px', color: '#94a3b8' }}>{producto.producto_id}</code>} />
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
    <div style={{ padding: '24px 0' }}>
      <div style={S.card}>
        <div style={S.sectionTitle}>Tabla de precios y costos</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: '#64748b', fontSize: '12px', borderBottom: '2px solid #e2e8f0' }}>
                  Moneda
                </th>
                <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 700, color: '#64748b', fontSize: '12px', borderBottom: '2px solid #e2e8f0' }}>
                  Precio de venta
                </th>
                <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 700, color: '#64748b', fontSize: '12px', borderBottom: '2px solid #e2e8f0' }}>
                  Costo
                </th>
                <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 700, color: '#64748b', fontSize: '12px', borderBottom: '2px solid #e2e8f0' }}>
                  Margen
                </th>
              </tr>
            </thead>
            <tbody>
              {allMonedas.map((mon, i) => {
                const precio = producto.precios[mon] ?? 0
                const costo  = producto.costos[mon]  ?? 0
                const margen = precio > 0 && costo > 0
                  ? ((precio - costo) / precio * 100).toFixed(1)
                  : null

                return (
                  <tr key={mon} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 10px', borderRadius: '6px',
                        background: '#f1f5f9', fontWeight: 700, fontSize: '12px',
                        fontFamily: 'monospace', letterSpacing: '0.04em',
                      }}>
                        {mon}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>
                      {precio > 0 ? fmt(precio, mon) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {costo > 0 ? fmt(costo, mon) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {margen !== null ? (
                        <span style={{ color: parseFloat(margen) > 20 ? '#16a34a' : parseFloat(margen) > 0 ? '#ca8a04' : '#dc2626', fontWeight: 600 }}>
                          {margen}%
                        </span>
                      ) : <span style={{ color: '#cbd5e1' }}>—</span>}
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
    <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
        <IconBoxLg />
      </div>
      <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: '#64748b' }}>
        Movimientos de inventario
      </div>
      <div style={{ fontSize: '13px' }}>
        Aquí se mostrarán entradas, salidas y ajustes de este producto.
      </div>
    </div>
  )
}

// ── Tab: Historial de precios (placeholder) ───────────────────────────────────

function TabHistorialPrecios() {
  return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
        <IconTrendingUpLg />
      </div>
      <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: '#64748b' }}>
        Historial de precios
      </div>
      <div style={{ fontSize: '13px' }}>
        Aquí se mostrará la evolución de precios y costos en el tiempo.
      </div>
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

  const cantNum     = parseFloat(cantidad) || 0
  const preview     = producto.stock_actual + cantNum

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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#fff', borderRadius: '16px', padding: '32px',
        width: '100%', maxWidth: '420px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <h3 style={{ margin: '0 0 20px', fontSize: '18px', fontWeight: 700 }}>
          Ajustar stock — {producto.nombre}
        </h3>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>Stock actual</div>
          <div style={{ fontSize: '24px', fontWeight: 700 }}>
            {producto.stock_actual.toLocaleString('es-VE')} {producto.unidad}
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
            Cantidad (+ entrada / − salida)
          </label>
          <input
            type="number" value={cantidad} onChange={e => setCantidad(e.target.value)}
            placeholder="ej: 10 o -5"
            style={{ width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
          />
        </div>

        {cantidad && !isNaN(parseFloat(cantidad)) && (
          <div style={{
            marginBottom: '16px', padding: '12px 16px', borderRadius: '8px',
            background: preview < 0 ? '#fef2f2' : '#f0fdf4',
            color: preview < 0 ? '#dc2626' : '#16a34a',
            fontSize: '13px', fontWeight: 600,
          }}>
            Stock resultante: {preview.toLocaleString('es-VE')} {producto.unidad}
            {preview < 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><IconAlertTriangle /> Stock negativo no permitido</span>}
          </div>
        )}

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
            Motivo del ajuste *
          </label>
          <input
            type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="ej: Conteo físico, devolución, etc."
            style={{ width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
          />
        </div>

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#fef2f2', color: '#dc2626', fontSize: '13px', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={pending || preview < 0}
            style={{
              flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
              background: pending || preview < 0 ? '#e2e8f0' : 'var(--color-primary, #0ea5e9)',
              color: pending || preview < 0 ? '#94a3b8' : '#fff',
              fontSize: '14px', fontWeight: 600, cursor: pending || preview < 0 ? 'not-allowed' : 'pointer',
            }}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', fontSize: '13px', color: '#64748b' }}>
        <Link href="/portal/productos" style={{ color: '#64748b', textDecoration: 'none' }}>
          Productos
        </Link>
        <span>›</span>
        <span style={{ color: 'var(--color-text, #1e293b)', fontWeight: 600 }}>{producto.nombre}</span>
      </div>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: '16px', flexWrap: 'wrap', marginBottom: '8px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800 }}>{producto.nombre}</h1>
            <span style={esServicio ? S.badgeServicio : S.badgeProducto}>
              {esServicio ? 'Servicio' : 'Producto'}
            </span>
            <span style={producto.estado === 'ACTIVO' ? S.badgeActivo : S.badgeInactivo}>
              {producto.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
            </span>
          </div>
          <div style={{ marginTop: '6px', fontSize: '13px', color: '#64748b' }}>
            <code style={{ fontFamily: 'monospace', color: '#0891b2', fontWeight: 600 }}>{producto.codigo}</code>
            {producto.codigo_proveedor && (
              <span style={{ marginLeft: '12px' }}>Cód. proveedor: <strong>{producto.codigo_proveedor}</strong></span>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {!esServicio && producto.estado === 'ACTIVO' && (
            <button
              onClick={() => setShowStock(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                border: '1px solid #0ea5e9', background: '#e0f2fe', color: '#0369a1', cursor: 'pointer',
              }}
            >
              <IconLayers /> Ajustar stock
            </button>
          )}
          <button
            onClick={() => setShowEdit(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
              border: '1px solid #e2e8f0', background: '#fff', color: '#1e293b', cursor: 'pointer',
            }}
          >
            <IconEdit /> Editar
          </button>
          <button
            onClick={toggleEstado}
            disabled={pending}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
              border: '1px solid #e2e8f0', background: '#fff',
              color: producto.estado === 'ACTIVO' ? '#dc2626' : '#16a34a',
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {producto.estado === 'ACTIVO' ? <><IconArchive /> Archivar</> : <><IconRestore /> Restaurar</>}
          </button>
        </div>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div style={{
          padding: '10px 16px', borderRadius: '8px', background: '#f0fdf4',
          color: '#16a34a', fontSize: '13px', fontWeight: 600, marginBottom: '16px',
        }}>
          {statusMsg}
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: '0', borderBottom: '1px solid #e2e8f0',
        overflowX: 'auto', marginBottom: '4px',
      }}>
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

      {/* Modal de edición — mismo formulario que en la lista */}
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

function IconX()             { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
function IconEdit()          { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function IconArchive()       { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> }
function IconRestore()       { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg> }
function IconLayers()        { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> }
function IconAlertTriangle() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> }
function IconBoxLg()         { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" style={{ opacity: 0.2 }}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> }
function IconTrendingUpLg()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="40" height="40" style={{ opacity: 0.2 }}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> }
