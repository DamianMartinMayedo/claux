'use client'

import { useState, useRef, useEffect, useCallback, type ReactNode, type CSSProperties } from 'react'
import { MoreHorizontal } from 'lucide-react'

/**
 * Menú de acciones de fila (icono ⋯ desplegable). Sustituye a las filas de
 * varios botones-icono en las tablas: una sola columna estrecha y uniforme.
 *
 * El menú se posiciona en `position: fixed` calculado desde el botón para
 * escapar del `overflow: hidden` de `.card-table` (si no, se recortaría).
 * La posición se pasa como custom properties (única excepción al no-inline).
 *
 * Uso: envolver botones `.row-actions-item` (+ `-danger` / `-success`).
 *   <RowActions>
 *     <button className="row-actions-item" onClick={…}><Pencil size={15} /> Editar</button>
 *     <button className="row-actions-item row-actions-item-danger" onClick={…}><Trash2 size={14} /> Eliminar</button>
 *   </RowActions>
 */
export function RowActions({
  children,
  label = 'Acciones',
}: {
  children: ReactNode
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setOpen(false), [])

  const toggle = useCallback(() => {
    setOpen(prev => {
      if (!prev && triggerRef.current) {
        const r = triggerRef.current.getBoundingClientRect()
        setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
      }
      return !prev
    })
  }, [])

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    // Un menú fijo se despega al hacer scroll/resize: mejor cerrarlo.
    document.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  return (
    <div className="row-actions" ref={wrapRef} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        ref={triggerRef}
        className="btn-icon row-actions-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>
      {open && pos && (
        <div
          className="row-actions-menu"
          role="menu"
          style={{ '--menu-top': `${pos.top}px`, '--menu-right': `${pos.right}px` } as CSSProperties}
          onClick={close}
        >
          {children}
        </div>
      )}
    </div>
  )
}
