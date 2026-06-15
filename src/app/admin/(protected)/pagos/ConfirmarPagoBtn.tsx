'use client'

import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { confirmarPago } from '@/app/actions/pagos'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'

export default function ConfirmarPagoBtn({
  pagoId,
  clienteNombre,
  monto,
  concepto,
}: {
  pagoId: string
  clienteNombre: string
  monto: number
  concepto: string | null
}) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const mounted = useMounted()
  const router = useRouter()

  const handleClose = useCallback(() => { setOpen(false) }, [])
  useModalKeyboard(open, handleClose)

  async function handleConfirm() {
    setLoading(true)
    const res = await confirmarPago(pagoId)
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al confirmar'); return }
    toastSuccess('Pago confirmado')
    handleClose()
    router.refresh()
  }

  const conceptoLabel = concepto === 'configuracion' ? 'configuración' : 'suscripción'

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-420">
        <div className="modal-header">
          <h2 className="modal-title">Confirmar pago</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="info-box">
            <strong className="info-box-title">{pagoId} · {clienteNombre}</strong>
            <span className="text-xs-muted">
              Marca como cobrado el pago de {conceptoLabel} por <strong>${monto.toFixed(2)} USD</strong>.
              A partir de aquí cuenta como ingreso. Hazlo solo cuando hayas verificado el dinero.
            </span>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleClose} disabled={loading}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={loading}>
            {loading ? <><span className="spinner" /> Confirmando...</> : 'Confirmar cobro'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <button
        className="btn btn-primary btn-sm"
        onClick={() => setOpen(true)}
        title="Confirmar cobro"
      >
        Confirmar
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
