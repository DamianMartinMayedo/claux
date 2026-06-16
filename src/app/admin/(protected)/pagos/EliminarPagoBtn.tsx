'use client'

import { AlertTriangle, Trash2, X } from 'lucide-react'
import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { eliminarPago } from '@/app/actions/pagos'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'

export default function EliminarPagoBtn({
  pagoId,
  clienteNombre,
}: {
  pagoId: string
  clienteNombre: string
}) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const mounted = useMounted()
  const router = useRouter()

  const handleClose = useCallback(() => { setOpen(false) }, [])

  useModalKeyboard(open, handleClose)

  async function handleConfirm() {
    setLoading(true)
    const res = await eliminarPago(pagoId)
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'Error al eliminar'); return }
    toastSuccess('Pago eliminado')
    handleClose()
    router.refresh()
  }

  const modal = (
    <div
      className="modal-backdrop"
     
    >
      <div className="modal modal-420">
        <div className="modal-header">
          <h2 className="modal-title">Eliminar pago</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="alert alert-error alert-top">
            <AlertTriangle size={18} className="flex-shrink-0 mt-px" />
            <div>
              <p className="confirm-title">¿Eliminar {pagoId}?</p>
              <p className="text-xs">
                Se eliminará el registro de pago de <strong>{clienteNombre}</strong> y se revertirá
                la fecha de expiración del cliente al período anterior. Esta acción no se puede deshacer.
              </p>
            </div>
          </div>

        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleClose} disabled={loading}>
            Cancelar
          </button>
          <button className="btn btn-danger" onClick={handleConfirm} disabled={loading}>
            {loading ? <><span className="spinner" /> Eliminando...</> : 'Eliminar pago'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <button
        className="btn-icon btn-icon-danger"
        onClick={() => setOpen(true)}
        title="Eliminar pago"
        aria-label="Eliminar pago"
      >
        <Trash2 size={15} />
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
