'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Incluir = 'todo' | 'instalacion' | 'suscripcion'
const HUECO = 4
const MARGEN = 8

export default function PresupuestoPdfMenu({
  nombre,
  onDownload,
  destacado = false,
  children,
}: {
  nombre: string
  onDownload: (incluir: Incluir) => void
  /** Cuando la descarga es LA acción del presupuesto (ya instalado: no queda nada que aprobar ni editar). */
  destacado?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => setMounted(true), [])

  // El menú vive en un portal sobre `document.body` (si no, el `overflow` del modal lo
  // recorta), así que su sitio hay que calcularlo a mano contra el botón que lo abre.
  useLayoutEffect(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!open || !trigger || !menu) return

    const triggerBox = trigger.getBoundingClientRect()
    const menuWidth = menu.offsetWidth
    const menuHeight = menu.offsetHeight
    // Bordes derechos alineados: el disparador vive en el pie del modal, pegado a la derecha.
    const left = Math.min(
      Math.max(MARGEN, triggerBox.right - menuWidth),
      Math.max(MARGEN, window.innerWidth - menuWidth - MARGEN),
    )
    const libreAbajo = window.innerHeight - triggerBox.bottom - HUECO - MARGEN
    const libreArriba = triggerBox.top - HUECO - MARGEN
    const arriba = menuHeight > libreAbajo && libreArriba > libreAbajo
    const maxHeight = Math.max(arriba ? libreArriba : libreAbajo, MARGEN)
    const top = arriba
      ? Math.max(MARGEN, triggerBox.top - HUECO - Math.min(menuHeight, maxHeight))
      : Math.min(window.innerHeight - MARGEN, triggerBox.bottom + HUECO)

    menu.style.setProperty('--pres-pdf-left', `${left}px`)
    menu.style.setProperty('--pres-pdf-top', `${top}px`)
    menu.style.setProperty('--pres-pdf-height', `${maxHeight}px`)
  }, [open, mounted])

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return
      close()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); triggerRef.current?.focus() }
    }
    function onScroll() { close() }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  function descargar(incluir: Incluir) {
    close()
    onDownload(incluir)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`btn ${destacado ? 'btn-primary' : 'btn-secondary'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        {children}
      </button>
      {open && mounted && createPortal(
        <div ref={menuRef} className="pres-pdf-menu" role="menu">
          <div className="ven-dropdown-ctx">
            {nombre}
            <span className="ven-dropdown-detalle">Qué incluir en el documento</span>
          </div>
          <button type="button" className="ven-dropdown-item" onClick={() => descargar('todo')}>Todo · instalación y suscripción</button>
          <button type="button" className="ven-dropdown-item" onClick={() => descargar('instalacion')}>Solo instalación · pago único</button>
          <button type="button" className="ven-dropdown-item" onClick={() => descargar('suscripcion')}>Solo suscripción · cuota mensual</button>
        </div>,
        document.body,
      )}
    </>
  )
}
