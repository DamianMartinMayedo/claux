'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Incluir = 'todo' | 'instalacion' | 'suscripcion'
const HUECO = 4
const MARGEN = 8

export default function PresupuestoPdfMenu({
  nombre,
  onDownload,
  children,
}: {
  nombre: string
  onDownload: (incluir: Incluir) => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => setMounted(true), [])

  useLayoutEffect(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!open || !trigger || !menu) return

    const triggerBox = trigger.getBoundingClientRect()
    const menuWidth = menu.offsetWidth
    const menuHeight = menu.offsetHeight
    const left = Math.min(
      Math.max(MARGEN, triggerBox.left),
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
  }, [open])

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return
      close()
    }
    function onScroll() { close() }
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  function descargar(incluir: Incluir) {
    close()
    onDownload(incluir)
  }

  return (
    <div className="pres-pdf-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
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
    </div>
  )
}
