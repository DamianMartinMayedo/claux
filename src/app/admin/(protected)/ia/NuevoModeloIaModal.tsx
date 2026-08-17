'use client'

import { Plus, X } from 'lucide-react'
import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { crearModeloIa } from '@/app/actions/ia-admin'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import FormHelp from '@/components/portal/FormHelp'
import { useMounted } from '@/lib/use-mounted'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'

// Alta de un modelo de IA. Dos caminos, y qué es obligatorio cambia según cuál:
//   · OpenCode Zen (por defecto): basta el id. Endpoint y clave salen de la
//     configuración por defecto del sistema — no hay nada más que rellenar.
//   · Proveedor propio (p. ej. Gemini): el endpoint y la API key pasan a ser obligatorios
//     (la clave se guarda cifrada en el sistema, sin tocar Vercel).
export default function NuevoModeloIaModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [zen, setZen] = useState(true)
  const [gratis, setGratis] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const mounted = useMounted()

  const handleClose = useCallback(() => { setOpen(false); setZen(true); setGratis(false) }, [])
  useModalKeyboard(open, handleClose)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData(formRef.current!)
    const id = ((fd.get('id') as string) ?? '').trim()
    if (!id) { toastError('Indica el id del modelo.'); return }

    // Con Zen no hay endpoint ni clave propia; con proveedor propio, ambos importan.
    const api_base    = zen ? null : ((fd.get('api_base')    as string) ?? '').trim() || null
    const api_key     = zen ? null : ((fd.get('api_key')     as string) ?? '').trim() || null
    const api_key_env = zen ? null : ((fd.get('api_key_env') as string) ?? '').trim() || null
    if (!zen) {
      if (!api_base) { toastError('Un proveedor propio necesita su endpoint.'); return }
      if (!api_key && !api_key_env) { toastError('Indica la API key del proveedor (o su variable de entorno).'); return }
    }

    setLoading(true)
    const r = await crearModeloIa({ id, nombre: ((fd.get('nombre') as string) ?? '').trim(), gratis, api_base, api_key, api_key_env })
    setLoading(false)
    if (!r.ok) { toastError(r.error); return }
    toastSuccess('Modelo añadido')
    handleClose()
    router.refresh()
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2 className="modal-title">Nuevo modelo</h2>
          <button onClick={handleClose} className="modal-close" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="grid-cols-2">
              <div className="input-group">
                <div className="form-label-with-help">
                  <label>ID del modelo <span className="required">*</span></label>
                  <FormHelp text="Tal cual lo espera el proveedor (sin prefijos)." label="Información sobre el ID del modelo" />
                </div>
                <input name="id" className="input" required placeholder="p. ej. claude-haiku-4-5" />
              </div>
              <div className="input-group">
                <label>Nombre visible</label>
                <input name="nombre" className="input" placeholder="Claude Haiku 4.5" />
              </div>
            </div>

            <div className="input-group">
              <label className="ia-check">
                <input type="checkbox" checked={zen} onChange={e => setZen(e.target.checked)} />
                <span>Usa OpenCode Zen (proveedor por defecto)</span>
              </label>
              <p className="config-field-hint">
                {zen
                  ? 'Sin endpoint ni clave: toma la configuración por defecto del sistema.'
                  : 'Proveedor propio: indica el endpoint y la API key (obligatorios).'}
              </p>
            </div>

            {!zen && (
              <>
                <div className="input-group">
                  <div className="form-label-with-help">
                    <label>Endpoint <span className="required">*</span></label>
                    <FormHelp text="La URL base OpenAI-compatible del proveedor. Ej.: el endpoint de Gemini." label="Información sobre el endpoint" />
                  </div>
                  <input name="api_base" className="input" placeholder="https://…/v1" />
                </div>
                <div className="grid-cols-2">
                  <div className="input-group">
                    <div className="form-label-with-help">
                      <label>API key <span className="required">*</span></label>
                      <FormHelp text="La clave del proveedor. Se guarda cifrada en el sistema y nunca se vuelve a mostrar. No hace falta tocar Vercel." label="Información sobre la API key" />
                    </div>
                    <input name="api_key" type="password" autoComplete="off" className="input" placeholder="se guarda cifrada" />
                  </div>
                  <div className="input-group">
                    <div className="form-label-with-help">
                      <label>Variable de la key</label>
                      <FormHelp text="Alternativa avanzada: nombre de una variable de entorno del servidor con la clave, en vez de guardarla aquí." label="Información sobre la variable de la key" />
                    </div>
                    <input name="api_key_env" className="input" placeholder="p. ej. GEMINI_API_KEY" />
                  </div>
                </div>
              </>
            )}

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
