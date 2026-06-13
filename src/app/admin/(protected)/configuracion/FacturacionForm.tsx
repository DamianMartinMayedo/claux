'use client'

import { useState } from 'react'
import { guardarSetting } from '@/app/actions/settings'

type Props = {
  setupDefault:   number
  descuentoAnual: number
  diasTrial:      number
}

export default function FacturacionForm({ setupDefault, descuentoAnual, diasTrial }: Props) {
  const [setup, setSetup]         = useState(String(setupDefault))
  const [descuento, setDescuento] = useState(String(descuentoAnual))
  const [trial, setTrial]         = useState(String(diasTrial))
  const [loading, setLoading]     = useState(false)
  const [msg, setMsg]             = useState('')
  const [error, setError]         = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setMsg(''); setError('')
    const r1 = await guardarSetting('pago_setup_usd_default', String(parseFloat(setup) || 0))
    const r2 = await guardarSetting('descuento_anual_pct',    String(parseInt(descuento, 10) || 0))
    const r3 = await guardarSetting('dias_trial_default',     String(parseInt(trial, 10) || 0))
    setLoading(false)
    if (!r1.ok || !r2.ok || !r3.ok) { setError('No se pudo guardar algún ajuste.'); return }
    setMsg('Ajustes de facturación guardados')
    setTimeout(() => setMsg(''), 2000)
  }

  return (
    <form onSubmit={handleSubmit} className="config-form">
      <div className="input-group">
        <label>Pago de configuración por defecto (USD)</label>
        <input type="number" min="0" step="0.01" className="input"
          value={setup} onChange={e => setSetup(e.target.value)} />
        <span className="input-hint">Importe prerellenado al crear un cliente (editable por cliente).</span>
      </div>

      <div className="grid-cols-2">
        <div className="input-group">
          <label>Descuento anual (%)</label>
          <input type="number" min="0" max="100" step="1" className="input"
            value={descuento} onChange={e => setDescuento(e.target.value)} />
          <span className="input-hint">Aplicado al cobrar el ciclo anual.</span>
        </div>
        <div className="input-group">
          <label>Días de prueba (trial)</label>
          <input type="number" min="0" max="180" step="1" className="input"
            value={trial} onChange={e => setTrial(e.target.value)} />
          <span className="input-hint">Vigencia inicial de un cliente en trial.</span>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {msg   && <div className="alert alert-success">{msg}</div>}

      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar ajustes'}
      </button>
    </form>
  )
}
