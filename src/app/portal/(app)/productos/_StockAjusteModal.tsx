'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useEffect, useTransition } from 'react'
import { ajustarStock, obtenerStockPorAlmacen } from '@/app/actions/portal/productos'
import { AlertTriangle, X } from 'lucide-react'

// Modal único de ajuste de stock, compartido por la tabla de Productos y el
// detalle de producto — antes eran dos componentes que se comportaban distinto.
// El input se precarga con el stock REAL del almacén (consulta propia, nunca
// datos que el llamador pudiera tener desactualizados) y el usuario lo edita
// directamente al valor que quiere dejar; el delta hacia ajustarStock() se
// calcula aquí.

interface Props {
  producto_id: string
  nombre:      string
  unidad:      string
  almacenes:   { almacen_id: string; nombre: string }[]
  onClose:     () => void
  onSaved:     () => void
}

export function StockAjusteModal({ producto_id, nombre, unidad, almacenes, onClose, onSaved }: Props) {
  const [isPending, startTransition] = useTransition()
  const [cargando,  setCargando]     = useState(true)
  const [stockMap,  setStockMap]     = useState<Record<string, number>>({})
  const [almacenId, setAlmacenId]    = useState(almacenes[0]?.almacen_id ?? '')
  const [cantidad,  setCantidad]     = useState('')
  const [motivo,    setMotivo]       = useState('')

  useEffect(() => {
    if (almacenes.length === 0) { setCargando(false); return }
    let activo = true
    obtenerStockPorAlmacen(producto_id).then(res => {
      if (!activo) return
      const map: Record<string, number> = {}
      for (const s of res) map[s.almacen_id] = s.cantidad
      setStockMap(map)

      // Seleccionar almacén por defecto: el que más stock tenga, o el primero si ninguno tiene
      let bestId = almacenes[0]?.almacen_id ?? ''
      let bestStock = -1
      for (const a of almacenes) {
        const s = map[a.almacen_id] ?? 0
        if (s > bestStock) { bestStock = s; bestId = a.almacen_id }
      }
      setAlmacenId(bestId)
      setCantidad(String(bestStock))
      setCargando(false)
    })
    return () => { activo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto_id])

  function handleAlmacenChange(id: string) {
    setAlmacenId(id)
    setCantidad(String(stockMap[id] ?? 0))
  }

  const stockActual = stockMap[almacenId] ?? 0
  const cantNum      = parseFloat(cantidad)
  const valido        = cantidad !== '' && !isNaN(cantNum) && cantNum >= 0
  const delta          = valido ? cantNum - stockActual : 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!almacenId)      return toastError('Selecciona un almacén.')
    if (!valido)          return toastError('Ingresa un stock válido.')
    if (delta === 0)      return toastError('El stock no ha cambiado.')
    if (!motivo.trim())   return toastError('El motivo del ajuste es obligatorio.')
    startTransition(async () => {
      const res = await ajustarStock(producto_id, almacenId, delta, motivo.trim())
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Ajustar stock — {nombre}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {almacenes.length === 0 ? (
              <p className="input-hint prd-stock-warn">Necesitas un almacén para ajustar el stock. Crea uno en Almacenes.</p>
            ) : cargando ? (
              <p className="input-hint"><span className="spinner spinner-sm" /> Cargando stock…</p>
            ) : (
              <>
                <div className="input-group">
                  <label htmlFor="stk-alm">Almacén <span className="required">*</span></label>
                  <select id="stk-alm" className="input" value={almacenId}
                    onChange={e => handleAlmacenChange(e.target.value)}>
                    {almacenes.map(a => {
                      const stk = stockMap[a.almacen_id] ?? 0
                      return <option key={a.almacen_id} value={a.almacen_id}>{a.nombre} · {stk.toLocaleString('es-VE')} {unidad}</option>
                    })}
                  </select>
                </div>

                <div className="prd-stock-actual-row">
                  <span>Stock antes del ajuste</span>
                  <strong>{stockActual.toLocaleString('es-VE')} {unidad}</strong>
                </div>

                <div className="input-group">
                  <label htmlFor="stk-cant">Nuevo stock <span className="required">*</span></label>
                  <input id="stk-cant" className="input" type="number" step="0.001" min="0"
                    value={cantidad} onChange={e => setCantidad(e.target.value)} autoFocus />
                  {valido && delta !== 0 && (
                    <span className="input-hint">
                      {delta > 0 ? `+${delta.toLocaleString('es-VE')}` : delta.toLocaleString('es-VE')} {unidad} sobre el stock actual
                    </span>
                  )}
                  {cantidad !== '' && !valido && (
                    <span className="input-hint prd-stock-warn">
                      <AlertTriangle size={13} strokeWidth={2} /> El stock no puede ser negativo
                    </span>
                  )}
                </div>
              </>
            )}
            <div className="input-group">
              <label htmlFor="stk-motivo">Motivo <span className="required">*</span></label>
              <input id="stk-motivo" className="input" placeholder="Ej: Compra, Ajuste de inventario, Merma…"
                value={motivo} onChange={e => setMotivo(e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || cargando || almacenes.length === 0}>
              {isPending ? <><span className="spinner spinner-sm" /> Aplicando…</> : 'Aplicar ajuste'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
