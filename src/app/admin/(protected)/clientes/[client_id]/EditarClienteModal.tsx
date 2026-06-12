'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { editarCliente } from '@/app/actions/clientes'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'

type Props = {
  cliente: {
    client_id: string
    nombre_empresa: string
    nombre_contacto: string | null
    email_admin: string
    notas: string | null
  }
}

export default function EditarClienteModal({ cliente }: Props) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const mounted = useMounted()
  const formRef = useRef<HTMLFormElement>(null)
  const router  = useRouter()

  const handleClose = useCallback(() => { setOpen(false); setError('') }, [])

  useModalKeyboard(open, handleClose)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    const res = await editarCliente(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error desconocido'); return }
    handleClose()
    router.refresh()
  }

  const modal = (
    <div
      className="modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Editar cliente</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <input type="hidden" name="client_id" value={cliente.client_id} />
          <div className="modal-body">

            <div className="input-group">
              <label>Nombre de la empresa <span className="required">*</span></label>
              <input
                name="nombre_empresa" className="input" required
                defaultValue={cliente.nombre_empresa}
                placeholder="Nombre de la empresa"
              />
            </div>

            <div className="input-group">
              <label>Nombre del contacto</label>
              <input
                name="nombre_contacto" className="input"
                defaultValue={cliente.nombre_contacto ?? ''}
                placeholder="Persona de contacto"
              />
            </div>

            <div className="input-group">
              <label>Email del administrador <span className="required">*</span></label>
              <input
                name="email_admin" type="email" className="input" required
                defaultValue={cliente.email_admin}
                placeholder="admin@empresa.com"
              />
            </div>

            <div className="input-group">
              <label>Notas internas</label>
              <textarea
                name="notas" className="input" rows={3}
                defaultValue={cliente.notas ?? ''}
                placeholder="Notas internas opcionales"
              />
            </div>

            {error && <div className="alert alert-error">{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Guardando…</> : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button className="btn-icon" onClick={() => setOpen(true)} title="Editar cliente" aria-label="Editar cliente">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>

      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
