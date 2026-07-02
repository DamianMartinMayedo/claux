'use client'

import { Sparkles } from 'lucide-react'

// Banner destacado (degradado de marca) para activar/desactivar que la IA
// gestione el bot de reservas o citas. Solo se renderiza si el cliente tiene el
// addon de IA contratado (lo decide la vista padre).
export default function IaBotBanner({
  entidad, activa, isPending, onToggle,
}: {
  entidad:   'reservas' | 'citas'
  activa:    boolean
  isPending: boolean
  onToggle:  (activa: boolean) => void
}) {
  const nombre = entidad === 'reservas' ? 'las reservas' : 'las citas'
  return (
    <div className="ia-banner">
      <span className="ia-banner-icon"><Sparkles size={22} strokeWidth={2} /></span>
      <div className="ia-banner-body">
        <span className="ia-banner-title">Asistente IA{activa ? ' · activo' : ''}</span>
        <span className="ia-banner-desc">
          {activa
            ? `Gestiona ${nombre} por Telegram en lenguaje natural, dentro de tus reglas y cierres.`
            : `Deja que la IA gestione ${nombre} por Telegram en lenguaje natural.`}
        </span>
      </div>
      <label className="switch ia-banner-switch">
        <input
          type="checkbox"
          checked={activa}
          disabled={isPending}
          onChange={e => onToggle(e.target.checked)}
          aria-label={`Que la IA gestione ${nombre}`}
        />
        <span className="switch-track" aria-hidden="true" />
      </label>
    </div>
  )
}
