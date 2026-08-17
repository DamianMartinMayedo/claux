'use client'

import { X } from 'lucide-react'
import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { editarModeloIa } from '@/app/actions/ia-admin'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import FormHelp from '@/components/portal/FormHelp'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import type { ModeloIa } from './IaAdminClient'

// Edición de un modelo de IA. Modal controlado por el padre (se abre desde el menú de
// acciones de la fila): se monta cuando hay `modelo` y se cierra con `onClose`. El id NO
// se toca (referencia del proveedor y del secreto en Vault). Lo obligatorio depende del
// proveedor (Zen vs propio), y la clave tiene dos caminos: guardada cifrada en el sistema
// (por defecto) o —oculto tras el check «avanzado»— una variable de entorno que gestiona
// el propietario en Vercel. La API key vacía = no se cambia; con clave guardada hay
// casilla para quitarla.
export default function EditarModeloIaModal({ modelo, onClose }: { modelo: ModeloIa; onClose: () => void }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [zen, setZen] = useState(!modelo.api_base)
  const [usarEnv, setUsarEnv] = useState(!!modelo.api_key_env && !modelo.key_hint)
  const [gratis, setGratis] = useState(modelo.gratis)
  const [quitarKey, setQuitarKey] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  useModalKeyboard(true, onClose)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData(formRef.current!)
    const nombre = ((fd.get('nombre') as string) ?? '').trim()

    let api_base: string | null = null
    let api_key: string | null = null
    let api_key_env: string | null = null
    let quitar = false

    if (zen) {
      // Zen no usa clave propia: se limpia cualquier secreto que hubiera guardado.
      quitar = true
    } else {
      api_base = ((fd.get('api_base') as string) ?? '').trim() || null
      if (!api_base) { toastError('Un proveedor propio necesita su endpoint.'); return }
      if (usarEnv) {
        api_key_env = ((fd.get('api_key_env') as string) ?? '').trim() || null
        if (!api_key_env) { toastError('Indica el nombre de la variable de entorno.'); return }
        quitar = true   // al pasar a variable, se borra la clave guardada en el sistema
      } else {
        api_key = ((fd.get('api_key') as string) ?? '').trim() || null
        api_key_env = null   // camino Vault: se descarta cualquier variable configurada
        quitar = quitarKey
        const tieneGuardada = !!modelo.key_hint && !quitarKey
        if (!api_key && !tieneGuardada) {
          toastError('Un proveedor propio necesita una API key.'); return
        }
      }
    }

    setLoading(true)
    const r = await editarModeloIa({ id: modelo.id, nombre, gratis, api_base, api_key, api_key_env, quitarKey: quitar })
    setLoading(false)
    if (!r.ok) { toastError(r.error); return }
    toastSuccess('Modelo actualizado')
    onClose()
    router.refresh()
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2 className="modal-title">Editar modelo</h2>
          <button onClick={onClose} className="modal-close" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="grid-cols-2">
              <div className="input-group">
                <label>ID del modelo</label>
                <input className="input" defaultValue={modelo.id} disabled />
              </div>
              <div className="input-group">
                <label>Nombre visible</label>
                <input name="nombre" className="input" defaultValue={modelo.nombre} placeholder={modelo.id} />
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
                  : 'Proveedor propio: indica el endpoint y la API key.'}
              </p>
            </div>

            {!zen && (
              <>
                <div className="input-group">
                  <div className="form-label-with-help">
                    <label>Endpoint <span className="required">*</span></label>
                    <FormHelp text="La URL base OpenAI-compatible del proveedor. Ej.: el endpoint de Gemini." label="Información sobre el endpoint" />
                  </div>
                  <input name="api_base" className="input" defaultValue={modelo.api_base ?? ''} placeholder="https://…/v1" />
                </div>

                {usarEnv ? (
                  <div className="input-group">
                    <div className="form-label-with-help">
                      <label>Nombre de la variable <span className="required">*</span></label>
                      <FormHelp text="El nombre de la variable de entorno del servidor con la clave. La creas tú en Vercel y en .env.local; aquí solo va el nombre." label="Información sobre la variable de entorno" />
                    </div>
                    <input name="api_key_env" className="input" defaultValue={modelo.api_key_env ?? ''} placeholder="p. ej. GEMINI_API_KEY" />
                  </div>
                ) : (
                  <>
                    <div className="input-group">
                      <div className="form-label-with-help">
                        <label>API key</label>
                        <FormHelp text="Se guarda cifrada y nunca se muestra. Déjala vacía para no cambiarla." label="Información sobre la API key" />
                      </div>
                      <input name="api_key" type="password" autoComplete="off" className="input" disabled={quitarKey}
                             placeholder={modelo.key_hint ? `guardada (${modelo.key_hint}) — escribe para cambiarla` : 'se guarda cifrada'} />
                    </div>
                    {modelo.key_hint && (
                      <label className="ia-check">
                        <input type="checkbox" checked={quitarKey} onChange={e => setQuitarKey(e.target.checked)} />
                        <span>Quitar la clave guardada ({modelo.key_hint})</span>
                      </label>
                    )}
                  </>
                )}

                <div className="input-group">
                  <label className="ia-check">
                    <input type="checkbox" checked={usarEnv} onChange={e => setUsarEnv(e.target.checked)} />
                    <span>Usar una variable de entorno para la clave (avanzado)</span>
                  </label>
                  <p className="config-field-hint">
                    {usarEnv
                      ? 'La clave vivirá en una variable de entorno que creas tú en Vercel (y en .env.local para local). Aquí solo pones su nombre; al guardar se borra la clave cifrada.'
                      : 'La clave se guarda cifrada en el sistema. Recomendado: no hay que tocar Vercel.'}
                  </p>
                </div>
              </>
            )}

            <label className="ia-check">
              <input type="checkbox" checked={gratis} onChange={e => setGratis(e.target.checked)} />
              <span>Es un modelo gratis</span>
            </label>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
