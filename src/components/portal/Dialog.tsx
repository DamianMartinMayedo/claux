'use client'

import { AlertTriangle } from 'lucide-react'

interface ConfirmProps {
  title:         string
  body?:         string
  confirmLabel?: string
  cancelLabel?:  string
  danger?:       boolean
  onConfirm:     () => void
  onCancel:      () => void
}

interface AlertProps {
  title:   string
  body?:   string
  onClose: () => void
}

export function ConfirmDialog({
  title, body, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false,
  onConfirm, onCancel,
}: ConfirmProps) {
  return (
    <div className="modal-backdrop open dialog-top">
      <div className="modal modal-confirm" role="alertdialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title dialog-title">
            {danger && <AlertTriangle size={18} strokeWidth={2} />}
            {title}
          </h2>
        </div>
        {body && (
          <div className="modal-body">
            <p className="dialog-text">{body}</p>
          </div>
        )}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function AlertDialog({ title, body, onClose }: AlertProps) {
  return (
    <div className="modal-backdrop open dialog-top">
      <div className="modal modal-alert" role="alertdialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title dialog-title">{title}</h2>
        </div>
        {body && (
          <div className="modal-body">
            <p className="dialog-text">{body}</p>
          </div>
        )}
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose} autoFocus>Aceptar</button>
        </div>
      </div>
    </div>
  )
}

