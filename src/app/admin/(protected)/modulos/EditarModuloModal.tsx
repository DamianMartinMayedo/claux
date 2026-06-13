'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { editarModulo } from '@/app/actions/modulos'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'

type Modulo = {
  clave: string
  nombre: string
  descripcion: string | null
  precio_fundador_usd: number
  precio_estandar_usd: number
  es_base: boolean
  tipo: string
  activo: boolean
}

export default function EditarModuloModal({ modulo }: { modulo: Modulo }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')
  const formRef               = useRef<HTMLFormElement>(null)
  const mounted               = useMounted()

  const handleClose = useCallback(() => {
    setOpen(false); setError(''); setSuccess('')
  }, [])

  useModalKeyboard(open, handleClose)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    const res = await editarModulo(new FormData(formRef.current!))
    setLoading(false)
    if (!res.ok) { setError(res.error ?? 'Error desconocido'); return }
    setSuccess('Guardado')
    setTimeout(handleClose, 900)
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-md">
        <div className="modal-header">
          <h2 className="modal-title">Editar módulo — {modulo.clave}</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit}>
          <input type="hidden" name="clave" value={modulo.clave} />
          <div className="modal-body">
            <div className="input-group">
              <label>Nombre <span className="required">*</span></label>
              <input name="nombre" className="input" required defaultValue={modulo.nombre} disabled={modulo.es_base} />
              {modulo.es_base && <span className="input-hint">La base contable no se puede renombrar.</span>}
            </div>
            <div className="input-group">
              <label>Descripción</label>
              <textarea name="descripcion" className="input" rows={2} defaultValue={modulo.descripcion ?? ''} />
            </div>
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Precio fundador (USD)</label>
                <input name="precio_fundador_usd" className="input" type="number" min="0" step="0.01" required defaultValue={modulo.precio_fundador_usd} />
              </div>
              <div className="input-group">
                <label>Precio estándar (USD)</label>
                <input name="precio_estandar_usd" className="input" type="number" min="0" step="0.01" required defaultValue={modulo.precio_estandar_usd} />
              </div>
            </div>
            {!modulo.es_base && (
              <label className="module-check">
                <input type="checkbox" name="activo" value="true" defaultChecked={modulo.activo} />
                Activo (visible en los toggles de cliente)
              </label>
            )}
            {modulo.es_base && <input type="hidden" name="activo" value="true" />}

            {error   && <div className="alert alert-error mt-3">{error}</div>}
            {success && <div className="alert alert-success mt-3">{success}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>Editar</button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
