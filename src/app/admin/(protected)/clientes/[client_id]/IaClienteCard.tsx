'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { setCupoClienteIa } from '@/app/actions/ia-admin'

interface Props {
  clientId: string
  cupoGlobal: number
  cupoOverride: number | null   // null = usa el global
  conversaciones: number
  tokens: number
  periodo: string
}

// Card de IA en la ficha del cliente: consumo del mes + override del cupo (subir
// el límite de este cliente). Solo se monta si el cliente tiene asistente_ia.
export default function IaClienteCard({ clientId, cupoGlobal, cupoOverride, conversaciones, tokens, periodo }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [valor, setValor] = useState(cupoOverride != null ? String(cupoOverride) : '')

  const cupoEfectivo = cupoOverride ?? cupoGlobal
  const pct = cupoEfectivo > 0 ? Math.round((conversaciones / cupoEfectivo) * 100) : 0

  function guardar(e: React.FormEvent) {
    e.preventDefault()
    const n = valor.trim() === '' ? null : parseInt(valor, 10)
    startTransition(async () => {
      const r = await setCupoClienteIa(clientId, n && n > 0 ? n : null)
      if (!r.ok) { toastError(r.error); return }
      toastSuccess(n && n > 0 ? `Cupo del cliente: ${n}/mes` : 'Cupo restablecido al global')
      router.refresh()
    })
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Asistente IA</h2>
        <span className={`badge ${pct >= 100 ? 'badge-error' : pct >= 90 ? 'badge-warning' : 'badge-neutral'}`}>{pct}% del cupo</span>
      </div>

      <div className="ia-uso-grid">
        <div className="ia-uso-item">
          <div className="ia-uso-num">{conversaciones.toLocaleString('es-ES')}<span className="ia-uso-lbl"> / {cupoEfectivo.toLocaleString('es-ES')}</span></div>
          <div className="ia-uso-lbl">Conversaciones ({periodo})</div>
        </div>
        <div className="ia-uso-item">
          <div className="ia-uso-num">{tokens.toLocaleString('es-ES')}</div>
          <div className="ia-uso-lbl">Tokens este mes</div>
        </div>
      </div>

      <form onSubmit={guardar} className="config-form mt-4">
        <div className="input-group">
          <label htmlFor="cupo-cli">Cupo propio de este cliente (conversaciones/mes)</label>
          <input id="cupo-cli" type="number" min="0" step="1" className="input"
                 value={valor} onChange={e => setValor(e.target.value)}
                 placeholder={`Global: ${cupoGlobal}`} />
          <span className="input-hint">Déjalo vacío para usar el cupo global. Súbelo si el cliente paga consumo extra de IA.</span>
        </div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={isPending}>
          {isPending ? <><span className="spinner" /> Guardando...</> : 'Guardar cupo'}
        </button>
      </form>
    </div>
  )
}
