'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { setCupoClienteIa } from '@/app/actions/ia-admin'
import FormHelp from '@/components/portal/FormHelp'

interface Props {
  clientId: string
  cupoNivel: number             // lo que incluye el nivel contratado
  nivelNombre: string
  cupoOverride: number | null   // null = usa el del nivel
  conversaciones: number
  tokens: number
  periodo: string
}

// Card de IA en la ficha del cliente: consumo del mes + override del cupo (subir
// el límite de este cliente). Solo se monta si el cliente tiene asistente_ia.
export default function IaClienteCard({ clientId, cupoNivel, nivelNombre, cupoOverride, conversaciones, tokens, periodo }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [valor, setValor] = useState(cupoOverride != null ? String(cupoOverride) : '')

  const cupoEfectivo = cupoOverride ?? cupoNivel
  const pct = cupoEfectivo > 0 ? Math.round((conversaciones / cupoEfectivo) * 100) : 0

  function guardar(e: React.FormEvent) {
    e.preventDefault()
    const n = valor.trim() === '' ? null : parseInt(valor, 10)
    startTransition(async () => {
      const r = await setCupoClienteIa(clientId, n && n > 0 ? n : null)
      if (!r.ok) { toastError(r.error); return }
      toastSuccess(n && n > 0 ? `Cupo del cliente: ${n}/mes` : 'Cupo restablecido al de su nivel')
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
          <div className="form-label-with-help">
            <label htmlFor="cupo-cli">Cupo propio de este cliente (conversaciones/mes)</label>
            <FormHelp text={`Déjalo vacío y usa el de su nivel (${nivelNombre}: ${cupoNivel.toLocaleString('es-ES')}/mes). Súbelo si el cliente paga consumo extra de IA. Pasado el cupo el asistente no se apaga: baja al modelo gratuito hasta el mes siguiente.`} label="Cómo funciona el cupo propio" />
          </div>
          <input id="cupo-cli" type="number" min="0" step="1" className="input"
                 value={valor} onChange={e => setValor(e.target.value)}
                 placeholder={`${nivelNombre}: ${cupoNivel}`} />
        </div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={isPending}>
          {isPending ? <><span className="spinner" /> Guardando...</> : 'Guardar cupo'}
        </button>
      </form>
    </div>
  )
}
