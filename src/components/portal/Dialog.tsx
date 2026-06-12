'use client'

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
            {danger && <IconWarn />}
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

function IconWarn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" className="dialog-warn-icon">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}
