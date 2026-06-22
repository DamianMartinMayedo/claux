'use client'

import { useState, useTransition } from 'react'
import { cancelarReservaPublica, type ReservaPublicaToken } from '@/app/actions/portal/reservas'
import { Check, Loader2, X } from 'lucide-react'

const ESTADO_LABEL: Record<string, string> = {
  PENDIENTE: 'Pendiente de confirmar', CONFIRMADA: 'Confirmada', RECHAZADA: 'Rechazada',
  NO_SHOW: 'No asistió', CANCELADA: 'Cancelada',
}
const ESTADO_CLASS: Record<string, string> = {
  PENDIENTE: 'rp-badge-warn', CONFIRMADA: 'rp-badge-ok', RECHAZADA: 'rp-badge-neutral',
  NO_SHOW: 'rp-badge-neutral', CANCELADA: 'rp-badge-neutral',
}

function formatFecha(f: string): string {
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function GestionReservaView({ data }: { data: ReservaPublicaToken }) {
  const [isPending, startTransition] = useTransition()
  const [estado, setEstado] = useState(data.estado)
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState('')
  const [cancelada, setCancelada] = useState(false)

  const titulo = data.tipo === 'cita' ? 'Tu cita' : 'Tu reserva'
  const cancelable = (estado === 'PENDIENTE' || estado === 'CONFIRMADA') && data.cancelable && !cancelada

  function handleCancelar() {
    setError('')
    startTransition(async () => {
      const res = await cancelarReservaPublica(data.token)
      if (!res.ok) { setError(res.error ?? 'No se pudo cancelar.'); setConfirmando(false); return }
      setEstado('CANCELADA'); setCancelada(true); setConfirmando(false)
    })
  }

  return (
    <div className="rp-card">
      <div className="rp-card-body">
        <h1 className="rp-title">{data.negocio}</h1>
        <p className="rp-subtitle">{titulo}</p>

        <div className="rp-resumen">
          <span><strong>{data.detalle}</strong></span>
          <span className="rp-resumen-hora">
            {formatFecha(data.fecha)}{data.hora ? ` · ${data.hora.substring(0, 5)}` : ''}
            {data.tipo === 'reserva' ? ` · ${data.personas} persona${data.personas !== 1 ? 's' : ''}` : ''}
          </span>
          <span><span className={`rp-badge ${ESTADO_CLASS[estado] ?? 'rp-badge-neutral'}`}>{ESTADO_LABEL[estado] ?? estado}</span></span>
        </div>

        {cancelada ? (
          <div className="rp-success">
            <Check size={36} strokeWidth={2} className="rp-success-icon" />
            <p className="rp-hint">Hemos cancelado tu {data.tipo === 'cita' ? 'cita' : 'reserva'}. Gracias por avisar.</p>
          </div>
        ) : cancelable ? (
          <>
            {!confirmando ? (
              <button type="button" className="rp-btn-danger" onClick={() => setConfirmando(true)} disabled={isPending}>
                <X size={16} /> Cancelar {data.tipo === 'cita' ? 'cita' : 'reserva'}
              </button>
            ) : (
              <>
                <p className="rp-hint">¿Seguro que quieres cancelar? No se puede deshacer.</p>
                <div className="rp-confirm-row">
                  <button type="button" className="rp-btn-secondary" onClick={() => setConfirmando(false)} disabled={isPending}>
                    No, mantener
                  </button>
                  <button type="button" className="rp-btn-danger" onClick={handleCancelar} disabled={isPending}>
                    {isPending ? <Loader2 size={16} className="rp-spin" /> : <X size={16} />} Sí, cancelar
                  </button>
                </div>
              </>
            )}
            {error && <div className="rp-error">{error}</div>}
          </>
        ) : (
          <p className="rp-hint">
            {estado === 'CANCELADA' ? 'Esta reserva está cancelada.'
              : estado === 'RECHAZADA' ? 'Esta reserva no fue aceptada.'
              : data.fecha < new Date().toISOString().split('T')[0] ? 'Esta reserva ya pasó.'
              : 'Esta reserva ya no se puede cancelar en línea. Contacta con el negocio.'}
          </p>
        )}
      </div>
    </div>
  )
}
