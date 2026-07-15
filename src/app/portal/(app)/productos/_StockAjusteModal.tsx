'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useEffect, useTransition } from 'react'
import { ajustarStock, obtenerStockPorAlmacen } from '@/app/actions/portal/productos'
import { AlertTriangle, Plus, Minus, Equal, X } from 'lucide-react'

// Modal único de ajuste de stock, compartido por la tabla de Productos y el
// detalle de producto. Tres modos para que no haya que calcular a mano:
//   · Añadir (+) — entra mercancía (compra, reposición)
//   · Quitar (−) — sale mercancía (merma, rotura, consumo)
//   · Fijar (=)  — se deja un total exacto (conteo físico / auditoría)
// El stock real del almacén se consulta aquí (nunca datos que el llamador pudiera
// tener desactualizados). La acción ajustarStock() recibe un DELTA con signo, que
// se calcula según el modo.

type Modo = 'añadir' | 'quitar' | 'fijar'

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
  const [modo,      setModo]         = useState<Modo>('añadir')
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
      setCargando(false)
    })
    return () => { activo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto_id])

  const stockActual = stockMap[almacenId] ?? 0

  function handleAlmacenChange(id: string) {
    setAlmacenId(id)
    // En "fijar" el input arranca en el stock del almacén elegido; en añadir/quitar
    // es una cantidad relativa que no depende del almacén.
    if (modo === 'fijar') setCantidad(String(stockMap[id] ?? 0))
  }

  function handleModoChange(nuevo: Modo) {
    if (nuevo === modo) return
    setModo(nuevo)
    setCantidad(nuevo === 'fijar' ? String(stockMap[almacenId] ?? 0) : '')
  }

  const cantNum = parseFloat(cantidad)
  const numOk    = cantidad !== '' && !isNaN(cantNum) && cantNum >= 0
  // Delta con signo según el modo (lo que espera ajustarStock).
  const delta      = !numOk ? 0
    : modo === 'añadir' ? cantNum
    : modo === 'quitar' ? -cantNum
    : cantNum - stockActual
  const resultante = stockActual + delta
  const negativo    = numOk && resultante < 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!almacenId)      return toastError('Selecciona un almacén.')
    if (!numOk)           return toastError('Ingresa una cantidad válida.')
    if (delta === 0)      return toastError(modo === 'fijar' ? 'El stock no ha cambiado.' : 'La cantidad debe ser mayor que cero.')
    if (negativo)         return toastError(`No puedes quitar más de lo disponible (${stockActual.toLocaleString('es-ES')} ${unidad}).`)
    if (!motivo.trim())   return toastError('El motivo del ajuste es obligatorio.')
    startTransition(async () => {
      const res = await ajustarStock(producto_id, almacenId, delta, motivo.trim())
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  const MODOS: { id: Modo; label: string; icon: React.ReactNode }[] = [
    { id: 'añadir', label: 'Añadir', icon: <Plus size={15} strokeWidth={2} /> },
    { id: 'quitar', label: 'Quitar', icon: <Minus size={15} strokeWidth={2} /> },
    { id: 'fijar',  label: 'Fijar',  icon: <Equal size={15} strokeWidth={2} /> },
  ]
  const labelCantidad = modo === 'fijar' ? 'Nuevo stock (total)'
    : modo === 'quitar' ? 'Cantidad a quitar' : 'Cantidad a añadir'

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
                      return <option key={a.almacen_id} value={a.almacen_id}>{a.nombre} · {stk.toLocaleString('es-ES')} {unidad}</option>
                    })}
                  </select>
                </div>

                <div className="prd-stock-actual-row">
                  <span>Stock antes del ajuste</span>
                  <strong>{stockActual.toLocaleString('es-ES')} {unidad}</strong>
                </div>

                <div className="prd-modo-seg" role="group" aria-label="Modo de ajuste">
                  {MODOS.map(m => (
                    <button key={m.id} type="button"
                      className={`prd-modo-btn${modo === m.id ? ' active' : ''}`}
                      aria-pressed={modo === m.id}
                      onClick={() => handleModoChange(m.id)}>
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>

                <div className="input-group">
                  <label htmlFor="stk-cant">{labelCantidad} <span className="required">*</span></label>
                  <input id="stk-cant" className="input" type="number" step="0.001" min="0"
                    value={cantidad} onChange={e => setCantidad(e.target.value)} autoFocus />
                  {numOk && delta !== 0 && !negativo && (
                    <span className="input-hint prd-stock-preview">
                      Quedará: <strong>{resultante.toLocaleString('es-ES')} {unidad}</strong>
                    </span>
                  )}
                  {negativo && (
                    <span className="input-hint prd-stock-warn">
                      <AlertTriangle size={13} strokeWidth={2} /> No puedes quitar más de lo disponible ({stockActual.toLocaleString('es-ES')} {unidad})
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
