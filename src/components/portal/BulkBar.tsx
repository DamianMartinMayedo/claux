'use client'

import { X } from 'lucide-react'
import type { ReactNode } from 'react'

// ── Barra flotante de acciones en lote (patrón reutilizable) ───────────────────
//
// Aparece anclada abajo y centrada cuando hay ≥1 fila seleccionada. A la izquierda
// el conteo + «Deseleccionar»; a la derecha, los botones de acción que le pases
// como children. Es puramente presentacional: la lógica (qué acciones, sobre qué
// filas) vive en quien la usa. Estilos en `.bulk-bar` (03-components.css).

export default function BulkBar({
  count, onClear, etiqueta, limpiarLabel, children,
}: {
  count:    number
  onClear:  () => void
  /** Sustituye al «N seleccionadas» por defecto. Lo usa el cuadrante de Turnos, donde
   *  lo que se acumula no son filas marcadas sino cambios sin guardar: la barra es la
   *  misma pieza, pero decir «seleccionadas» ahí sería mentir. */
  etiqueta?: ReactNode
  /** Por defecto «Deseleccionar»; en Turnos es «Descartar». */
  limpiarLabel?: string
  children: ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="bulk-bar" role="region" aria-label="Acciones en lote">
      <div className="bulk-bar-inner">
        <div className="bulk-bar-count">
          {etiqueta ?? <span><strong>{count}</strong> seleccionada{count === 1 ? '' : 's'}</span>}
          <button type="button" className="bulk-bar-clear" onClick={onClear}>
            <X size={14} strokeWidth={2} /> {limpiarLabel ?? 'Deseleccionar'}
          </button>
        </div>
        <div className="bulk-bar-actions">
          {children}
        </div>
      </div>
    </div>
  )
}
