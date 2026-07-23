'use client'

import { Pencil, X } from 'lucide-react'
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
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Editar cliente</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <X size={18} />
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
        <Pencil size={15} />
      </button>

      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
