'use client'

import { Pencil, X } from 'lucide-react'
import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { editarPago } from '@/app/actions/pagos'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'

type Pago = {
  pago_id: string; client_id: string; concepto: string | null
  monto_usd: number; metodo: string
  fecha_inicio_periodo: string | null; fecha_fin_periodo: string | null
  notas: string | null
}

function toYMD(s: string | null): string {
  if (!s) return ''
  return s.split('T')[0]
}

function formatDateES(dateStr: string): string {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

export default function EditarPagoModal({
  pago,
  clienteNombre,
}: {
  pago: Pago
  clienteNombre: string
}) {
  const esConfiguracion = pago.concepto === 'configuracion'

  const [open, setOpen]     = useState(false)
  const [loading, setLoading] = useState(false)
  const mounted = useMounted()

  const [monto, setMonto]         = useState(String(pago.monto_usd))
  const [metodo, setMetodo]       = useState(pago.metodo)
  const [fechaInicio, setFechaInicio] = useState(toYMD(pago.fecha_inicio_periodo))
  const [fechaFin, setFechaFin]   = useState(toYMD(pago.fecha_fin_periodo))
  const [notas, setNotas]         = useState(pago.notas ?? '')

  const formRef = useRef<HTMLFormElement>(null)
  const router  = useRouter()

  const handleClose = useCallback(() => {
    setOpen(false); 
  }, [])

  useModalKeyboard(open, handleClose)

  function handleOpen() {
    // Resetear a valores actuales del pago
    setMonto(String(pago.monto_usd))
    setMetodo(pago.metodo)
    setFechaInicio(toYMD(pago.fecha_inicio_periodo))
    setFechaFin(toYMD(pago.fecha_fin_periodo))
    setNotas(pago.notas ?? '')
    
    setOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await editarPago(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al guardar'); return }
    toastSuccess(res.esUltimo
      ? 'Pago actualizado · Expiración sincronizada'
      : 'Pago actualizado')
    setTimeout(() => { handleClose(); router.refresh() }, 1400)
  }

  const modal = (
    <div
      className="modal-backdrop"
     
    >
      <div className="modal modal-520">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Editar pago</h2>
            <p className="text-xs-muted">
              {pago.pago_id} · {clienteNombre}
            </p>
          </div>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">
            <input type="hidden" name="pago_id" value={pago.pago_id} />

            {/* Concepto + Método */}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Concepto</label>
                <div className="input input-display">
                  {esConfiguracion ? 'Configuración (pago único)' : 'Suscripción'}
                </div>
              </div>
              <div className="input-group">
                <label>Método <span className="required">*</span></label>
                <select
                  name="metodo"
                  className="input"
                  required
                  value={metodo}
                  onChange={e => setMetodo(e.target.value)}
                >
                  <option value="tropipay">TropiPay</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                </select>
              </div>
            </div>

            {/* Monto */}
            <div className="input-group">
              <label>Monto USD <span className="required">*</span></label>
              <input
                name="monto_usd"
                type="number"
                step="any"
                min="0.01"
                className="input"
                required
                value={monto}
                onChange={e => setMonto(e.target.value)}
                placeholder="0.00"
              />
            </div>

            {/* Período (solo suscripción) */}
            {!esConfiguracion && (
              <div className="grid-cols-2">
                <div className="input-group">
                  <label>Inicio período <span className="required">*</span></label>
                  <input
                    name="fecha_inicio_periodo"
                    type="date"
                    lang="es-ES"
                    className="input"
                    required
                    value={fechaInicio}
                    onChange={e => setFechaInicio(e.target.value)}
                  />
                  {fechaInicio && (
                    <span className="text-xs-muted">
                      {formatDateES(fechaInicio)}
                    </span>
                  )}
                </div>
                <div className="input-group">
                  <label>Fin período <span className="required">*</span></label>
                  <input
                    name="fecha_fin_periodo"
                    type="date"
                    lang="es-ES"
                    className="input"
                    required
                    value={fechaFin}
                    onChange={e => setFechaFin(e.target.value)}
                  />
                  {fechaFin && (
                    <span className="text-xs-muted">
                      {formatDateES(fechaFin)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Notas */}
            <div className="input-group">
              <label>Notas</label>
              <textarea
                name="notas"
                className="input"
                rows={2}
                value={notas}
                onChange={e => setNotas(e.target.value)}
                placeholder="Referencia de pago, observaciones..."
              />
            </div>

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button
        className="btn-icon"
        onClick={handleOpen}
        title="Editar pago"
        aria-label="Editar pago"
      >
        <Pencil size={15} />
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
