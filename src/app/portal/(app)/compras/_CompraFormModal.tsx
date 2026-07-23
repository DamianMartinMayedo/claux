'use client'

import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { useState, useMemo, useTransition } from 'react'
import { Plus, X, Trash2 }                  from 'lucide-react'
import {
  guardarCompra,
  type Compra,
  type CompraLinea,
  type ProductoCompra,
} from '@/app/actions/portal/compras'

function fmt(n: number, moneda: string) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: moneda, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)
}

export interface CompraFormData {
  proveedores: { tercero_id: string; nombre: string; moneda_defecto: string | null }[]
  almacenes:   { almacen_id: string; nombre: string; empresa_id: string }[]
  productos:   ProductoCompra[]
  monedas:     string[]
}

interface LineaUI {
  producto_id:    string
  descripcion:    string
  cantidad:       number
  costo_unitario: number
}

export function CompraFormModal({
  form, compra, lineasIniciales, onClose, onSaved,
}: {
  form:            CompraFormData
  compra?:         Compra
  lineasIniciales?: CompraLinea[]
  onClose:         () => void
  onSaved:         (compra_id: string) => void
}) {
  const [isPending, startTransition] = useTransition()
  const isEdit = !!compra

  const [almacenId,   setAlmacenId]   = useState(compra?.almacen_id ?? form.almacenes[0]?.almacen_id ?? '')
  const [proveedorId, setProveedorId] = useState(compra?.proveedor_id ?? '')
  const [moneda,      setMoneda]      = useState(compra?.moneda ?? form.monedas[0] ?? 'USD')
  const [fecha,       setFecha]       = useState(compra?.fecha ?? new Date().toISOString().split('T')[0])
  const [notas,       setNotas]       = useState(compra?.notas ?? '')
  const [lineas,      setLineas]      = useState<LineaUI[]>(
    lineasIniciales && lineasIniciales.length
      ? lineasIniciales.map(l => ({
          producto_id: l.producto_id ?? '', descripcion: l.descripcion,
          cantidad: l.cantidad, costo_unitario: l.costo_unitario,
        }))
      : [{ producto_id: '', descripcion: '', cantidad: 1, costo_unitario: 0 }],
  )

  const total = useMemo(
    () => lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0),
    [lineas],
  )

  function addLinea() {
    setLineas([...lineas, { producto_id: '', descripcion: '', cantidad: 1, costo_unitario: 0 }])
  }
  function removeLinea(i: number) { setLineas(lineas.filter((_, idx) => idx !== i)) }
  function updateLinea(i: number, patch: Partial<LineaUI>) {
    setLineas(lineas.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function onDescripcion(i: number, val: string) {
    const match = form.productos.find(p => `${p.codigo} — ${p.nombre}` === val)
    if (match) {
      updateLinea(i, {
        producto_id: match.producto_id, descripcion: val,
        costo_unitario: match.costos[moneda] ?? lineas[i].costo_unitario ?? 0,
      })
    } else {
      updateLinea(i, { producto_id: '', descripcion: val })
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const validas = lineas.filter(l => l.descripcion.trim() && l.cantidad > 0)
    if (!almacenId)           { toastError('Selecciona el almacén de entrada.'); return }
    if (validas.length === 0) { toastError('Añade al menos una línea con cantidad.'); return }

    const fd = new FormData()
    if (compra) fd.set('compra_id', compra.compra_id)
    fd.set('almacen_id',   almacenId)
    fd.set('proveedor_id', proveedorId)
    fd.set('moneda',       moneda)
    fd.set('fecha',        fecha)
    fd.set('notas',        notas)
    fd.set('lineas', JSON.stringify(validas.map(l => ({
      producto_id: l.producto_id || null,
      descripcion: l.descripcion.trim(),
      cantidad: l.cantidad,
      costo_unitario: l.costo_unitario,
    }))))

    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarCompra(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess(isEdit ? 'Compra actualizada' : 'Compra creada en borrador')
      onSaved(res.compra_id!)
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-xl" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? `Editar compra ${compra!.numero}` : 'Nueva compra'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">

            <div className="ven-form-section">
              <span className="ven-form-section-title">Datos de la compra</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-3">
                  <label htmlFor="cmp-alm">Almacén de entrada <span className="required">*</span></label>
                  <select id="cmp-alm" className="input" value={almacenId} onChange={e => setAlmacenId(e.target.value)} required>
                    <option value="">Selecciona almacén…</option>
                    {form.almacenes.map(a => <option key={a.almacen_id} value={a.almacen_id}>{a.nombre}</option>)}
                  </select>
                </div>
                <div className="input-group ter-col-span-3">
                  <label htmlFor="cmp-prov">Proveedor</label>
                  <select id="cmp-prov" className="input" value={proveedorId} onChange={e => setProveedorId(e.target.value)}>
                    <option value="">Sin proveedor</option>
                    {form.proveedores.map(p => <option key={p.tercero_id} value={p.tercero_id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div className="input-group ter-col-span-2">
                  <label htmlFor="cmp-mon">Moneda <span className="required">*</span></label>
                  <select id="cmp-mon" className="input" value={moneda} onChange={e => setMoneda(e.target.value)} required>
                    {form.monedas.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="input-group ter-col-span-2">
                  <label htmlFor="cmp-fecha">Fecha</label>
                  <input id="cmp-fecha" className="input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="ven-form-section">
              <div className="ven-section-header">
                <span className="ven-form-section-title">Líneas</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addLinea}>
                  <Plus size={12} strokeWidth={2.5} /> Añadir línea
                </button>
              </div>

              {lineas.length === 0 ? (
                <div className="ven-empty-mini">Sin líneas. Añade al menos una para guardar.</div>
              ) : (
                <div className="ven-lineas-table">
                  <div className="cmp-lineas-head">
                    <div>Producto / descripción</div>
                    <div className="ven-col-num">Cant.</div>
                    <div className="ven-col-num">Costo</div>
                    <div className="ven-col-num">Total</div>
                    <div className="ven-col-del"></div>
                  </div>
                  {lineas.map((l, i) => (
                    <div key={i} className="cmp-lineas-row">
                      <div className="cmp-col-prod">
                        <input className="input input-sm" type="text" list={`cmp-prod-${i}`}
                          placeholder="Escribe o selecciona un producto…"
                          value={l.descripcion} onChange={e => onDescripcion(i, e.target.value)} />
                        <datalist id={`cmp-prod-${i}`}>
                          {form.productos.map(p => <option key={p.producto_id} value={`${p.codigo} — ${p.nombre}`} />)}
                        </datalist>
                      </div>
                      <div className="ven-col-num" data-label="Cant.">
                        <input className="input input-sm ven-input-num" type="number" min="0" step="any"
                          value={l.cantidad}
                          onChange={e => updateLinea(i, { cantidad: parseFloat(e.target.value) || 0 })}
                          onFocus={e => e.target.select()} />
                      </div>
                      <div className="ven-col-num" data-label="Costo">
                        <input className="input input-sm ven-input-num" type="number" min="0" step="any"
                          value={l.costo_unitario}
                          onChange={e => updateLinea(i, { costo_unitario: parseFloat(e.target.value) || 0 })}
                          onFocus={e => e.target.select()} />
                      </div>
                      <div className="ven-col-num ven-total-cell" data-label="Total">{fmt(l.cantidad * l.costo_unitario, moneda)}</div>
                      <div className="ven-col-del">
                        <button type="button" className="ter-action-btn ter-action-danger"
                          onClick={() => removeLinea(i)} title="Eliminar línea">
                          <Trash2 size={13} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ven-bottom-row">
              <div className="ven-totales-resumen">
                <div className="ven-total-row ven-total-final">
                  <span>Total</span>
                  <strong>{fmt(total, moneda)}</strong>
                </div>
              </div>
              <div className="ven-notas-inline">
                <label className="ven-notas-label" htmlFor="cmp-notas">Notas</label>
                <textarea id="cmp-notas" className="input input-textarea ven-notas-textarea" rows={3}
                  value={notas} onChange={e => setNotas(e.target.value)}
                  placeholder="Nº de factura del proveedor, referencias…" />
              </div>
            </div>

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios' : 'Crear borrador'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
