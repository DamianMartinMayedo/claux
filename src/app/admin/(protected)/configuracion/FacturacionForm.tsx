'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useState } from 'react'
import { guardarSetting } from '@/app/actions/settings'
import FormHelp from '@/components/portal/FormHelp'

type Props = {
  descuentoAnual: number
  diasTrial:      number
}

// El «Pago de configuración por defecto» ($1.000) ya no está: era un importe fijo que solo
// usaba el alta manual de cliente y que podía contradecir al coste calculado del presupuesto
// para ese mismo cliente. El precio de instalación se decide en un sitio — el presupuesto.
export default function FacturacionForm({ descuentoAnual, diasTrial }: Props) {
  const [descuento, setDescuento] = useState(String(descuentoAnual))
  const [trial, setTrial]         = useState(String(diasTrial))
  const [loading, setLoading]     = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const r1 = await guardarSetting('descuento_anual_pct', String(parseInt(descuento, 10) || 0))
    const r2 = await guardarSetting('dias_trial_default',  String(parseInt(trial, 10) || 0))
    setLoading(false)
    if (!r1.ok || !r2.ok) { toastError('No se pudo guardar algún ajuste.'); return }
    toastSuccess('Ajustes de facturación guardados')
  }

  return (
    <form onSubmit={handleSubmit} className="config-form">
      <div className="grid-cols-2">
        <div className="input-group">
          <div className="form-label-with-help">
            <label>Descuento anual (%)</label>
            <FormHelp text="Aplicado al cobrar el ciclo anual." label="Cuándo se aplica el descuento anual" />
          </div>
          <input type="number" min="0" max="100" step="1" className="input"
            value={descuento} onChange={e => setDescuento(e.target.value)} />
        </div>
        <div className="input-group">
          <div className="form-label-with-help">
            <label>Días de prueba (trial)</label>
            <FormHelp text="Vigencia inicial de un cliente en trial." label="Qué son los días de prueba" />
          </div>
          <input type="number" min="0" max="180" step="1" className="input"
            value={trial} onChange={e => setTrial(e.target.value)} />
        </div>
      </div>

      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar ajustes'}
      </button>
    </form>
  )
}
