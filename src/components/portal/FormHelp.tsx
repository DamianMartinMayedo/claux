'use client'

import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import { CircleHelp, TriangleAlert } from 'lucide-react'

/**
 * Ayuda contextual junto a una etiqueta o dato: un icono que, al pasar el ratón o
 * enfocarlo, abre una burbuja con el texto. `tone='warning'` cambia el `?` por el
 * triángulo de aviso (ámbar) — para señalar un problema, no solo explicar un campo.
 */
export default function FormHelp({
  text, label = 'Más información', tone = 'info', size = 15,
}: { text: string; label?: string; tone?: 'info' | 'warning'; size?: number }) {
  const tooltipId = useId()
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  function placeTooltip(e: { currentTarget: HTMLButtonElement }) {
    const rect = e.currentTarget.getBoundingClientRect()
    setPosition({ top: rect.bottom, left: rect.left + rect.width / 2 })
  }

  const Icono = tone === 'warning' ? TriangleAlert : CircleHelp

  return (
    <button type="button" className={`form-help-trigger${tone === 'warning' ? ' form-help-trigger-warning' : ''}`}
      aria-label={label} aria-describedby={tooltipId} title={label}
      onMouseEnter={placeTooltip} onFocus={placeTooltip}
      onMouseLeave={() => setPosition(null)} onBlur={() => setPosition(null)}>
      <Icono size={size} strokeWidth={2} />
      <span id={tooltipId} className="form-help-tooltip"
        style={position ? {
          '--form-help-top': `${position.top}px`,
          '--form-help-left': `${position.left}px`,
        } as CSSProperties : undefined}
        role="tooltip">
        {text}
      </span>
    </button>
  )
}
