'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useState } from 'react'
import { guardarSetting } from '@/app/actions/settings'

type Props = { model: string; apiBase: string }

// Modelo y endpoint del proveedor de IA, editables sin redeploy (la API key vive
// en env/secret, no aquí). MVP: opencode/deepseek-v4-flash-free. Pasar a pago =
// cambiar el id del modelo.
export default function IaConfigForm({ model, apiBase }: Props) {
  const [m, setM]       = useState(model)
  const [base, setBase] = useState(apiBase)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const r1 = await guardarSetting('ia_model',    m.trim())
    const r2 = await guardarSetting('ia_api_base', base.trim())
    setLoading(false)
    if (!r1.ok || !r2.ok) { toastError('No se pudo guardar algún ajuste.'); return }
    toastSuccess('Ajustes de IA guardados')
  }

  return (
    <form onSubmit={handleSubmit} className="config-form">
      <div className="input-group">
        <label htmlFor="ia-model">Modelo</label>
        <input id="ia-model" className="input" value={m} onChange={e => setM(e.target.value)}
               placeholder="deepseek-v4-flash-free" />
        <span className="input-hint">ID del modelo del proveedor. Cambiar a un modelo de pago aquí (sin redeploy).</span>
      </div>
      <div className="input-group">
        <label htmlFor="ia-base">Endpoint del proveedor</label>
        <input id="ia-base" className="input" value={base} onChange={e => setBase(e.target.value)}
               placeholder="https://opencode.ai/zen/v1" />
        <span className="input-hint">Base OpenAI-compatible. La API key se configura en el servidor (variable de entorno).</span>
      </div>
      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar ajustes'}
      </button>
    </form>
  )
}
