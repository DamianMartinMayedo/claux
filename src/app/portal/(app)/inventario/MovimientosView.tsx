'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { useState, useMemo, useTransition } from 'react'
import { useRouter }                        from 'next/navigation'
import {
  Plus, X, Package, RefreshCw,
  ArrowDownToLine, ArrowUpFromLine, Settings2, ArrowRightLeft,
} from 'lucide-react'
import {
  registrarMovimiento,
  reconciliarStock,
  type MovimientosPageData,
  type Movimiento,
} from '@/app/actions/portal/inventario'
import type { TipoMovimiento } from '@/app/actions/portal/_inventario-helpers'

// ── Configuración de tipos ──────────────────────────────────────────────────────

const TIPOS: TipoMovimiento[] = ['ENTRADA', 'SALIDA', 'AJUSTE', 'TRANSFERENCIA']

const TIPO_LABEL: Record<TipoMovimiento, string> = {
  ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste', TRANSFERENCIA: 'Transferencia',
}
const TIPO_DESC: Record<TipoMovimiento, string> = {
  ENTRADA:       'Suma stock a un almacén (recepción manual)',
  SALIDA:        'Resta stock de un almacén (consumo, merma)',
  AJUSTE:        'Corrige el stock tras un conteo físico (+/−)',
  TRANSFERENCIA: 'Mueve stock de un almacén a otro',
}
const TIPO_BADGE: Record<TipoMovimiento, string> = {
  ENTRADA: 'badge-success', SALIDA: 'badge-warning', AJUSTE: 'badge-info', TRANSFERENCIA: 'badge-purple',
}
function TipoIcon({ tipo, size = 15 }: { tipo: TipoMovimiento; size?: number }) {
  const props = { size, strokeWidth: 2 }
  if (tipo === 'ENTRADA')       return <ArrowDownToLine {...props} />
  if (tipo === 'SALIDA')        return <ArrowUpFromLine {...props} />
  if (tipo === 'AJUSTE')        return <Settings2 {...props} />
  return <ArrowRightLeft {...props} />
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Modal: nuevo movimiento ───────────────────────────────────────────────────

function MovimientoModal({
  data, onClose, onSaved,
}: {
  data:    MovimientosPageData
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [tipo,      setTipo]      = useState<TipoMovimiento>('ENTRADA')
  const [productoId, setProductoId] = useState('')
  const [almacenId, setAlmacenId]  = useState('')
  const [destinoId, setDestinoId]  = useState('')
  const [cantidad,  setCantidad]   = useState('')

  const producto = data.productos.find(p => p.producto_id === productoId)
  const esTransfer = tipo === 'TRANSFERENCIA'
  const destinos = data.almacenes.filter(a => a.almacen_id !== almacenId)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('tipo', tipo)
    startTransition(async () => {
      const res = await registrarMovimiento(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Movimiento registrado')
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Nuevo movimiento</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">

            {/* Tipo */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Tipo de movimiento</span>
              <div className="alm-tipo-grid">
                {TIPOS.map(t => (
                  <button key={t} type="button"
                    onClick={() => setTipo(t)}
                    className={`alm-tipo-btn${tipo === t ? ' active' : ''}`}>
                    <span className={`badge ${TIPO_BADGE[t]}`}>
                      <TipoIcon tipo={t} size={12} /> {TIPO_LABEL[t]}
                    </span>
                    <span className="text-xs-hint">{TIPO_DESC[t]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Datos */}
            <div className="ter-form-section mb-0">
              <span className="ter-form-section-title">Datos del movimiento</span>
              <div className="ter-form-grid">

                <div className="input-group ter-col-span-4">
                  <label htmlFor="mov-prod">Producto <span className="required">*</span></label>
                  <select id="mov-prod" className="input" name="producto_id" required
                    value={productoId} onChange={e => setProductoId(e.target.value)}>
                    <option value="">Selecciona un producto…</option>
                    {data.productos.map(p => (
                      <option key={p.producto_id} value={p.producto_id}>{p.nombre} ({p.codigo})</option>
                    ))}
                  </select>
                  {data.productos.length === 0 && (
                    <span className="text-xs-hint">No hay productos activos. Crea uno en Productos.</span>
                  )}
                </div>

                <div className="input-group ter-col-span-2">
                  <label htmlFor="mov-fecha">Fecha</label>
                  <input id="mov-fecha" className="input" type="date" name="fecha"
                    defaultValue={new Date().toISOString().split('T')[0]} />
                </div>

                <div className="input-group ter-col-span-3">
                  <label htmlFor="mov-alm">{esTransfer ? 'Almacén origen' : 'Almacén'} <span className="required">*</span></label>
                  <select id="mov-alm" className="input" name="almacen_id" required
                    value={almacenId} onChange={e => setAlmacenId(e.target.value)}>
                    <option value="">Selecciona un almacén…</option>
                    {data.almacenes.map(a => (
                      <option key={a.almacen_id} value={a.almacen_id}>{a.nombre}</option>
                    ))}
                  </select>
                </div>

                {esTransfer && (
                  <div className="input-group ter-col-span-3">
                    <label htmlFor="mov-dest">Almacén destino <span className="required">*</span></label>
                    <select id="mov-dest" className="input" name="almacen_destino_id" required
                      value={destinoId} onChange={e => setDestinoId(e.target.value)}>
                      <option value="">Selecciona destino…</option>
                      {destinos.map(a => (
                        <option key={a.almacen_id} value={a.almacen_id}>{a.nombre}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className={`input-group ${esTransfer ? 'ter-col-span-3' : 'ter-col-span-3'}`}>
                  <label htmlFor="mov-cant">
                    Cantidad {producto ? `(${producto.unidad})` : ''} <span className="required">*</span>
                  </label>
                  <input id="mov-cant" className="input" type="number" step="any" name="cantidad" required
                    value={cantidad} onChange={e => setCantidad(e.target.value)}
                    placeholder={tipo === 'AJUSTE' ? 'ej: 10 o −5' : 'ej: 10'} />
                  {tipo === 'AJUSTE' && (
                    <span className="text-xs-hint">Usa signo: positivo suma, negativo resta.</span>
                  )}
                </div>

                {tipo === 'ENTRADA' && (
                  <div className="input-group ter-col-span-3">
                    <label htmlFor="mov-costo">Costo unitario</label>
                    <input id="mov-costo" className="input" type="number" step="any" name="costo_unitario"
                      placeholder="opcional" />
                  </div>
                )}

                <div className="input-group ter-col-full">
                  <label htmlFor="mov-motivo">
                    Motivo {tipo === 'AJUSTE' && <span className="required">*</span>}
                  </label>
                  <input id="mov-motivo" className="input" type="text" name="motivo"
                    placeholder="ej: Conteo físico, recepción, merma…" />
                </div>

              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : 'Registrar movimiento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function MovimientosView({ data }: { data: MovimientosPageData }) {
  const router = useRouter()
  const [modalOpen,   setModalOpen]   = useState(false)
  const [showRecalc,  setShowRecalc]  = useState(false)
  const [filtroTipo,  setFiltroTipo]  = useState('')
  const [filtroAlm,   setFiltroAlm]   = useState('')
  const [, startTransition]           = useTransition()
  const [recalcPending, startRecalc]  = useTransition()

  function doRecalcular() {
    startRecalc(async () => {
      const res = await reconciliarStock()
      if (!res.ok) { toastError(res.error ?? 'Error'); return }
      toastSuccess(`Stock recalculado (${res.productos ?? 0} productos)`)
      setShowRecalc(false)
      router.refresh()
    })
  }

  const filtrados = useMemo(() => {
    return data.movimientos.filter(m => {
      if (filtroTipo && m.tipo !== filtroTipo) return false
      if (filtroAlm && m.almacen_id !== filtroAlm && m.almacen_destino_id !== filtroAlm) return false
      return true
    })
  }, [data.movimientos, filtroTipo, filtroAlm])

  function onSaved() { setModalOpen(false); startTransition(() => router.refresh()) }

  function signo(m: Movimiento): { txt: string; cls: string } {
    const n = m.cantidad.toLocaleString('es-VE')
    if (m.tipo === 'ENTRADA')       return { txt: `+${n}`, cls: 'mov-cant-pos' }
    if (m.tipo === 'SALIDA')        return { txt: `−${n}`, cls: 'mov-cant-neg' }
    if (m.tipo === 'AJUSTE')        return { txt: m.cantidad >= 0 ? `+${n}` : `−${Math.abs(m.cantidad).toLocaleString('es-VE')}`, cls: m.cantidad >= 0 ? 'mov-cant-pos' : 'mov-cant-neg' }
    return { txt: n, cls: 'mov-cant-neutral' }
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Movimientos</h1>
            <IaTouchpoint tipo="inventario" descripcion="un análisis de tu inventario" />
          </div>
          <p className="page-subtitle">Entradas, salidas, ajustes y transferencias de stock entre almacenes.</p>
        </div>
        <div className="det-actions">
          <button className="btn btn-secondary" onClick={() => setShowRecalc(true)} disabled={recalcPending}
            title="Reconstruye el stock a partir del historial de movimientos">
            <RefreshCw size={14} strokeWidth={2} /> Recalcular stock
          </button>
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}
            disabled={data.almacenes.length === 0 || data.productos.length === 0}>
            <Plus size={14} strokeWidth={2.5} /> Nuevo movimiento
          </button>
        </div>
      </div>

      {(data.almacenes.length === 0 || data.productos.length === 0) && (
        <div className="alm-nota-info">
          <strong className="text-muted">Para registrar movimientos</strong> necesitas al menos un{' '}
          <strong className="text-muted">producto</strong> activo y un{' '}
          <strong className="text-muted">almacén</strong>.
        </div>
      )}

      {/* Toolbar */}
      <div className="ter-toolbar">
        <select className="input ter-filter-select" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {TIPOS.map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
        </select>
        {data.almacenes.length > 1 && (
          <select className="input ter-filter-select" value={filtroAlm} onChange={e => setFiltroAlm(e.target.value)}>
            <option value="">Todos los almacenes</option>
            {data.almacenes.map(a => <option key={a.almacen_id} value={a.almacen_id}>{a.nombre}</option>)}
          </select>
        )}
      </div>

      {/* Tabla */}
      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">Historial de movimientos</h2>
          <span className="text-xs-muted">{filtrados.length} de {data.movimientos.length}</span>
        </div>

        {filtrados.length === 0 ? (
          <div className="mon-empty">
            <Package size={40} strokeWidth={1} opacity={0.2} />
            <p>
              {data.movimientos.length === 0
                ? 'Aún no hay movimientos de inventario. Registra el primero o confirma una compra.'
                : 'No hay resultados para los filtros seleccionados.'}
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Producto</th>
                  <th>Almacén</th>
                  <th className="col-num">Cantidad</th>
                  <th>Motivo</th>
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(m => {
                  const s = signo(m)
                  return (
                    <tr key={m.movimiento_id}>
                      <td data-label="Fecha" className="text-sm-muted">{fmtDate(m.fecha)}</td>
                      <td data-label="Tipo">
                        <span className={`badge ${TIPO_BADGE[m.tipo]}`}>
                          <TipoIcon tipo={m.tipo} size={12} /> {TIPO_LABEL[m.tipo]}
                        </span>
                      </td>
                      <td data-label="Producto"><strong>{data.producto_nombres[m.producto_id] ?? m.producto_id}</strong></td>
                      <td data-label="Almacén" className="text-sm-muted">
                        {m.tipo === 'TRANSFERENCIA' && m.almacen_destino_id
                          ? <>{data.almacen_nombres[m.almacen_id] ?? m.almacen_id} <ArrowRightLeft size={11} strokeWidth={2} /> {data.almacen_nombres[m.almacen_destino_id] ?? m.almacen_destino_id}</>
                          : (data.almacen_nombres[m.almacen_id] ?? m.almacen_id)}
                      </td>
                      <td data-label="Cantidad" className={`col-num ${s.cls}`}>{s.txt}</td>
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
        )}
      </div>

      {modalOpen && (
        <MovimientoModal data={data} onClose={() => setModalOpen(false)} onSaved={onSaved} />
      )}

      {showRecalc && (
        <div className="modal-backdrop open">
          <div className="modal modal-sm" role="dialog" aria-modal>
            <div className="modal-header">
              <h2 className="modal-title">Recalcular stock</h2>
              <button type="button" className="modal-close" onClick={() => setShowRecalc(false)}><X size={16} strokeWidth={2} /></button>
            </div>
            <div className="modal-body">
              <div className="modal-body-text">
                Reconstruye el stock de todos los productos a partir del historial de movimientos
                (la fuente de verdad). Úsalo si sospechas un descuadre. No crea ni borra movimientos.
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowRecalc(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={doRecalcular} disabled={recalcPending}>
                {recalcPending ? <><span className="spinner spinner-sm" /> Recalculando…</> : 'Recalcular'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
