'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

/**
 * Botón «Volver» de las páginas legales. Vuelve a DONDE ESTABAS, por este orden:
 *
 *   1. Historia de la pestaña → atrás (landing, diagnóstico, otra página legal…).
 *   2. `?volver=<ruta>` → lo pone quien abre el enlace en pestaña nueva (el perfil
 *      del portal). Es la ÚNICA pista fiable ahí: una pestaña nueva no tiene historia
 *      y el `referrer` lo borra el propio `rel="noreferrer"` del enlace, así que el
 *      botón acababa siempre en la landing y sacaba del portal a quien solo había
 *      abierto las cookies desde su perfil.
 *   3. `referrer` del mismo origen, por si el enlace vino de otro sitio sin parámetro.
 *   4. Sin ninguna pista (entrada directa desde Google) → la landing.
 *
 * El `href="/"` es el fallback sin JS: si no hidrata, el enlace sigue llevando a la
 * home, que es lo razonable para un visitante público.
 *
 * El parámetro se lee de `window.location` DENTRO del manejador y no con
 * `useSearchParams()`: estas páginas son estáticas (ISR) y ese hook las obligaría a
 * renderizarse en cliente o a envolverse en un Suspense, para leer algo que solo
 * hace falta cuando alguien pulsa.
 */
export default function VolverLink() {
  const router = useRouter()

  /** Ruta interna, o null. Nunca una URL absoluta: acaba en un `push`. */
  function destinoDelParametro(): string | null {
    const v = new URLSearchParams(window.location.search).get('volver')
    if (!v || !v.startsWith('/') || v.startsWith('//')) return null
    return v
  }

  function volver(e: React.MouseEvent) {
    e.preventDefault()
    if (typeof window === 'undefined') return

    if (window.history.length > 1) {
      router.back()
      return
    }

    const delParametro = destinoDelParametro()
    if (delParametro) { router.push(delParametro); return }

    const ref = document.referrer
    if (ref) {
      try {
        const url = new URL(ref)
        if (url.origin === window.location.origin) {
          router.push(url.pathname + url.search)
          return
        }
      } catch { /* referrer no parseable: caemos al fallback */ }
    }
    router.push('/')
  }

  return (
    <Link href="/" onClick={volver} className="lg-volver">
      <ArrowLeft size={16} />
      Volver
    </Link>
  )
}
