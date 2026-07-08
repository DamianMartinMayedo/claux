'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'

interface Props {
  /** Selector del contenedor shell al que se le aplica `.nav-open` (p. ej. ".portal-shell"). */
  shellSelector: string
  /** id del <aside> de navegación, para `aria-controls`. */
  navId: string
}

/**
 * Hamburguesa + backdrop para la navegación off-canvas en móvil/tablet.
 * La sidebar (admin o portal) vive en el shell como columna del grid; bajo el
 * breakpoint de shell (1024px) el CSS la convierte en drawer y esta pieza es la
 * única forma de abrirla. Comparte estado con la sidebar vía la clase `.nav-open`
 * en el shell (evita tener que atravesar los server components del layout con
 * contexto). Cierra al navegar, con Escape y al tocar el backdrop.
 */
export default function MobileNavToggle({ shellSelector, navId }: Props) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const pathname = usePathname()

  useEffect(() => setMounted(true), [])

  // Cerrar al cambiar de ruta (los <Link> del drawer navegan → se cierra solo).
  useEffect(() => { setOpen(false) }, [pathname])

  // Reflejar el estado en el shell + bloquear el scroll del cuerpo mientras abierto.
  useEffect(() => {
    const shell = document.querySelector(shellSelector)
    shell?.classList.toggle('nav-open', open)
    document.body.classList.toggle('nav-locked', open)
    return () => {
      shell?.classList.remove('nav-open')
      document.body.classList.remove('nav-locked')
    }
  }, [open, shellSelector])

  // Escape para cerrar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Al pasar a escritorio (p. ej. rotar la tablet a horizontal) la sidebar vuelve
  // a ser columna fija del grid: cerrar el drawer para no dejar el backdrop colgado.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    function onChange() { if (mq.matches) setOpen(false) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return (
    <>
      <button
        type="button"
        className="mobile-nav-toggle"
        aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={open}
        aria-controls={navId}
        onClick={() => setOpen(o => !o)}
      >
        {open ? <X size={22} strokeWidth={2} /> : <Menu size={22} strokeWidth={2} />}
      </button>
      {mounted && open && createPortal(
        <div className="nav-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />,
        document.body,
      )}
    </>
  )
}
