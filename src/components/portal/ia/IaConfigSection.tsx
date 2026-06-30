'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarIaConfig, type IaPanel } from '@/app/actions/portal/ia'

// Sección "Asistente IA" del perfil. Solo se renderiza con el addon contratado
// (el page decide pasándole panel != null). Permite nombrar al agente y ver el
// consumo del mes.
export default function IaConfigSection({ panel }: { panel: IaPanel }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const r = await guardarIaConfig(fd)
      if (!r.ok) { toastError(r.error ?? 'No se pudo guardar.'); return }
      toastSuccess('Asistente actualizado.')
      router.refresh()
    })
  }

  const { uso } = panel
  return (
    <div className="card mb-5">
      <div className="prf-card-header">
        <h2 className="prf-section-title"><Sparkles size={16} strokeWidth={2} /> Asistente IA</h2>
      </div>

      <form onSubmit={handleSubmit} className="prf-form">
        <div className="prf-form-row">
          <div className="input-group">
            <label htmlFor="ia-nombre">Nombre del asistente</label>
            <input id="ia-nombre" className="input" name="nombre_agente" defaultValue={panel.nombreAgente}
                   placeholder="Asistente" maxLength={40} />
            <span className="input-hint">Así se presentará en el chat y en Telegram.</span>
          </div>
          <div className="input-group">
            <label htmlFor="ia-tono">Tono</label>
            <input id="ia-tono" className="input" name="tono" defaultValue={panel.tono}
                   placeholder="cercano y profesional" maxLength={60} />
          </div>
        </div>

        <div className="ia-uso-grid">
          <div className="ia-uso-item">
            <div className={uso.cercaDelTope ? 'ia-uso-num ia-uso-warn' : 'ia-uso-num'}>
              {uso.conversaciones}<span className="ia-uso-lbl"> / {uso.cupo}</span>
            </div>
            <div className="ia-uso-lbl">Conversaciones este mes</div>
          </div>
          <div className="ia-uso-item">
            <div className="ia-uso-num">{(uso.tokensIn + uso.tokensOut).toLocaleString('es-ES')}</div>
            <div className="ia-uso-lbl">Tokens usados este mes</div>
          </div>
        </div>
        {uso.cercaDelTope && (
          <span className="input-hint">Estás cerca del límite mensual de conversaciones del asistente.</span>
        )}

        <div className="prf-form-submit">
          <button type="submit" className="btn btn-primary" disabled={isPending}>
            {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar asistente'}
          </button>
        </div>
      </form>
    </div>
  )
}
