'use client'

import { Plus, X } from 'lucide-react'
import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { crearModeloIa } from '@/app/actions/ia-admin'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'

// Alta de un modelo de IA (típicamente de pago, con su API). Botón principal → modal.
export default function NuevoModeloIaModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [gratis, setGratis] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const mounted = useMounted()

  const handleClose = useCallback(() => { setOpen(false) }, [])
  useModalKeyboard(open, handleClose)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData(formRef.current!)
    const id = ((fd.get('id') as string) ?? '').trim()
    if (!id) { toastError('Indica el id del modelo.'); return }
    setLoading(true)
    const r = await crearModeloIa({
      id,
      nombre: ((fd.get('nombre') as string) ?? '').trim(),
      gratis,
      api_base: ((fd.get('api_base') as string) ?? '').trim() || null,
    })
    setLoading(false)
    if (!r.ok) { toastError(r.error); return }
    toastSuccess('Modelo añadido')
    setGratis(false)
    handleClose()
    router.refresh()
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-md">
        <div className="modal-header">
          <h2 className="modal-title">Nuevo modelo</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="grid-cols-2">
              <div className="input-group">
                <label>ID del modelo <span className="required">*</span></label>
                <input name="id" className="input" required placeholder="p. ej. claude-haiku-4-5" />
                <span className="input-hint">Tal cual lo espera el proveedor (sin prefijos).</span>
              </div>
              <div className="input-group">
                <label>Nombre visible</label>
                <input name="nombre" className="input" placeholder="Claude Haiku 4.5" />
              </div>
            </div>
            <div className="input-group">
              <label>Endpoint (opcional)</label>
              <input name="api_base" className="input" placeholder="vacío = mismo proveedor (OpenCode Zen)" />
              <span className="input-hint">Solo si el modelo usa otra API. La key va en variable de entorno del servidor.</span>
            </div>
            <label className="ia-check">
              <input type="checkbox" checked={gratis} onChange={e => setGratis(e.target.checked)} />
              <span>Es un modelo gratis</span>
            </label>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Añadiendo...</> : 'Añadir modelo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={14} strokeWidth={2.5} /> Nuevo modelo
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
