'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

// Barra de progreso global de navegación. Presupuesto Cuba (conexión mala): ante
// CUALQUIER navegación el usuario ve al instante que "algo está pasando", sin
// esperar a que pinte la página nueva. Arranca con:
//   · clics en enlaces (<Link>/<a> del mismo origen),
//   · clics en filas de tabla clicables (.table-row-clickable → router.push),
//   · history.pushState / popstate (navegación programática y atrás/adelante),
//   · `avisarNavegacion()`, para un router.push() disparado desde un botón.
// Se completa cuando cambia el pathname (ruta nueva lista). Un tope de seguridad
// la retira si la navegación no llega a cambiar la ruta.

const EVENTO_NAV = 'claux:nav-inicio'

/**
 * Enciende la barra ANTES de un `router.push()` hecho a mano.
 *
 * Hace falta porque el detector de clics solo entiende `<a>` y filas de tabla:
 * un botón que navega (una notificación de la bandeja, por ejemplo) no lo
 * dispara. Y esperar al `history.pushState` del router no vale — el App Router
 * lo llama DESPUÉS de traerse la ruta, que es justo el rato en el que el usuario
 * se queda sin saber si su clic hizo algo. En Cuba ese rato son segundos.
 */
export function avisarNavegacion(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_NAV))
}
export default function TopLoader() {
  const pathname = usePathname()
  // Un filtro de listado navega con `router.replace()`: MISMA ruta, otros parámetros. Si
  // solo se mirara el pathname, la barra arrancaría y no se cerraría nunca (hasta el tope
  // de 10 s), que es peor que no tenerla.
  const search   = useSearchParams().toString()
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
      // El primer repintado se aplaza UN MICROTASK a propósito. `begin` también se
      // llama desde el `history.pushState` que parcheamos más abajo, y el App
      // Router lo invoca dentro de un *insertion effect* de React, donde un
      // `setState` es ilegal («useInsertionEffect must not schedule updates») y
      // React lo canta por consola en cada navegación programática. El microtask
      // sale de esa fase de commit sin retraso perceptible; lo que no es estado de
      // React —banderas y temporizadores— sigue yendo en el momento.
      queueMicrotask(() => {
        if (!activo) return   // la ruta cambió antes de que llegáramos a pintar
        setVisible(true)
        setProgress(0.08)
      })
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

    // Sin `this`: el React Compiler no compila una función que lo use y se saltaba este
    // efecto entero. `history` es el mismo objeto al que se le está parcheando el método,
    // así que aplicarlo sobre él es exactamente lo que hacía el `this`.
    const origPush = history.pushState
    history.pushState = function (...args: Parameters<History['pushState']>) {
      begin()
      return origPush.apply(history, args)
    }
    // `replaceState` TAMBIÉN, que es por donde pasa `router.replace()`: es lo que usan todos
    // los filtros de listado (rango, búsqueda, «Traer más»), o sea las navegaciones que más
    // se repiten en un día de trabajo. Sin esto, cambiar de rango en Gastos no encendía nada
    // y el dueño se quedaba mirando la pantalla vieja varios segundos en 3G — y volvía a
    // pulsar. `finish` se dispara ahora también al cambiar los searchParams (ver abajo),
    // porque en un `replace` la ruta no cambia y la barra se habría quedado colgada hasta el
    // tope de seguridad.
    const origReplace = history.replaceState
    history.replaceState = function (...args: Parameters<History['replaceState']>) {
      begin()
      return origReplace.apply(history, args)
    }
    window.addEventListener('popstate', begin)
    window.addEventListener(EVENTO_NAV, begin)
    document.addEventListener('click', onClick, true)

    return () => {
      history.pushState = origPush
      history.replaceState = origReplace
      window.removeEventListener('popstate', begin)
      window.removeEventListener(EVENTO_NAV, begin)
      document.removeEventListener('click', onClick, true)
      parar()
      if (ocultar) clearTimeout(ocultar)
    }
  }, [])

  // Completa al cambiar de ruta O de parámetros (la página nueva ya está lista).
  useEffect(() => { finishRef.current() }, [pathname, search])

  return (
    <div
      className="top-loader"
      data-visible={visible}
      style={{ '--tl-progress': progress } as React.CSSProperties}
      aria-hidden="true"
    />
  )
}
