'use client'

import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import { CircleHelp } from 'lucide-react'

export default function FormHelp({ text, label = 'Más información' }: { text: string; label?: string }) {
  const tooltipId = useId()
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  function placeTooltip(e: { currentTarget: HTMLButtonElement }) {
    const rect = e.currentTarget.getBoundingClientRect()
    setPosition({ top: rect.bottom, left: rect.left + rect.width / 2 })
  }

  return (
    <button type="button" className="form-help-trigger" aria-label={label}
      aria-describedby={tooltipId} title={label}
      onMouseEnter={placeTooltip} onFocus={placeTooltip}
      onMouseLeave={() => setPosition(null)} onBlur={() => setPosition(null)}>
      <CircleHelp size={15} strokeWidth={2} />
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
