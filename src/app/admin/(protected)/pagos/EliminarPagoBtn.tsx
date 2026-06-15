'use client'

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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="alert alert-error alert-top">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-px">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
