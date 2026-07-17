'use client'

import { useState, useRef, useEffect, useLayoutEffect, useCallback, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

/** Separación con el botón, y respiro mínimo con el borde de la ventana. */
const HUECO = 4
const MARGEN = 8

/**
 * Menú de acciones de fila (icono ⋯ desplegable). Sustituye a las filas de
 * varios botones-icono en las tablas: una sola columna estrecha y uniforme.
 *
 * El menú va en `position: fixed` para escapar del `overflow: hidden` de
 * `.card-table` (si no, se recortaría). Su posición solo se conoce en runtime,
 * así que se le pasa a la clase como custom properties (única excepción al
 * no-inline): el aspecto lo pone entero `.row-actions-menu`.
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
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen(prev => !prev), [])

  /* Se mide el menú ya montado y se coloca debajo del botón o, si ahí no cabe,
     encima. Si no cabe entero por ningún lado se acota su alto y hace scroll
     interno: en las últimas filas de una tabla ya no queda recortado contra el
     borde de la ventana. Va en useLayoutEffect —y escribe en el nodo, sin
     pasar por estado— para que el menú sin colocar no llegue a pintarse. */
  useLayoutEffect(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!open || !trigger || !menu) return

    const r = trigger.getBoundingClientRect()
    // Primero el eje horizontal: así el alto se mide ya con el ancho definitivo.
    menu.style.setProperty('--menu-right', `${window.innerWidth - r.right}px`)

    const alto = menu.offsetHeight
    const libreAbajo = window.innerHeight - r.bottom - HUECO - MARGEN
    const libreArriba = r.top - HUECO - MARGEN
    const haciaArriba = alto > libreAbajo && libreArriba > libreAbajo
    const altoFinal = Math.min(alto, Math.max(haciaArriba ? libreArriba : libreAbajo, 0))

    menu.style.setProperty('--menu-alto', `${altoFinal}px`)
    menu.style.setProperty('--menu-top', `${haciaArriba ? r.top - HUECO - altoFinal : r.bottom + HUECO}px`)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    // Un menú fijo se despega al hacer scroll/resize: mejor cerrarlo. Salvo que
    // el scroll sea el del propio menú cuando se ha tenido que acotar su alto.
    function onScroll(e: Event) {
      if (menuRef.current && e.target === menuRef.current) return
      close()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('scroll', onScroll, true)
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
      {open && (
        <div ref={menuRef} className="row-actions-menu" role="menu" onClick={close}>
          {children}
        </div>
      )}
    </div>
  )
}
