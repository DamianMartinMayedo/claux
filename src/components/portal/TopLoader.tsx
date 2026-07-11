'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

// Barra de progreso global de navegación. Presupuesto Cuba (conexión mala): ante
// CUALQUIER navegación el usuario ve al instante que "algo está pasando", sin
// esperar a que pinte la página nueva. Arranca con:
//   · clics en enlaces (<Link>/<a> del mismo origen),
//   · clics en filas de tabla clicables (.table-row-clickable → router.push),
//   · history.pushState / popstate (navegación programática y atrás/adelante).
// Se completa cuando cambia el pathname (ruta nueva lista). Un tope de seguridad
// la retira si la navegación no llega a cambiar la ruta.
export default function TopLoader() {
  const pathname = usePathname()
  const [progress, setProgress] = useState(0)
  const [visible, setVisible]   = useState(false)
  const finishRef = useRef<() => void>(() => {})

  useEffect(() => {
    let activo = false
    let trickle:   ReturnType<typeof setInterval> | null = null
    let seguridad: ReturnType<typeof setTimeout>  | null = null
    let ocultar:   ReturnType<typeof setTimeout>  | null = null

    const parar = () => {
      if (trickle)   { clearInterval(trickle);  trickle = null }
      if (seguridad) { clearTimeout(seguridad); seguridad = null }
    }

    const finish = () => {
      if (!activo) return
      activo = false
      parar()
      setProgress(1)
      ocultar = setTimeout(() => { setVisible(false); setProgress(0) }, 260)
    }

    const begin = () => {
      if (activo) return
      activo = true
      if (ocultar) clearTimeout(ocultar)
      setVisible(true)
      setProgress(0.08)
      // Sube deprisa al principio y se va frenando hacia el 90% (nunca llega solo).
      trickle = setInterval(() => {
        setProgress(p => (p >= 0.9 ? p : p + (0.9 - p) * 0.12))
      }, 240)
      // Tope de seguridad: si la navegación no cambia la ruta, no dejar la barra colgada.
      seguridad = setTimeout(finish, 10000)
    }

    finishRef.current = finish

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (!t) return

      const a = t.closest('a')
      if (a) {
        const href = a.getAttribute('href')
        if (!href || href.startsWith('#') || a.target === '_blank' || a.hasAttribute('download')) return
        try {
          const url = new URL(a.href, location.href)
          if (url.origin !== location.origin) return
          if (url.pathname === location.pathname && url.search === location.search) return
        } catch { return }
        begin()
        return
      }

      // Filas de tabla clicables: navegan por router.push en su onClick. Se ignora
      // el clic sobre controles internos (menús de acciones, botones, enlaces).
      const fila = t.closest('.table-row-clickable')
      if (fila && !t.closest('button, a, input, select, [role="button"], .row-actions, .ter-action-btn')) {
        begin()
      }
    }

    const origPush = history.pushState
    history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
      begin()
      return origPush.apply(this, args)
    }
    window.addEventListener('popstate', begin)
    document.addEventListener('click', onClick, true)

    return () => {
      history.pushState = origPush
      window.removeEventListener('popstate', begin)
      document.removeEventListener('click', onClick, true)
      parar()
      if (ocultar) clearTimeout(ocultar)
    }
  }, [])

  // Completa al cambiar de ruta (la página nueva ya está lista).
  useEffect(() => { finishRef.current() }, [pathname])

  return (
    <div
      className="top-loader"
      data-visible={visible}
      style={{ '--tl-progress': progress } as React.CSSProperties}
      aria-hidden="true"
    />
  )
}
