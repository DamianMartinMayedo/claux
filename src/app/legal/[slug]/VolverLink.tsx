'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

/**
 * Botón «Volver» de las páginas legales. Antes iba fijo a `/` (la landing), y
 * eso sacaba del portal a un cliente que abría las cookies desde su Perfil: caía
 * en la web comercial. Ahora vuelve a DONDE ESTABAS:
 *   1. Si hay historia en esta pestaña → atrás (landing, diagnóstico, otro legal…).
 *   2. Si es pestaña nueva —el portal abre los legales con target=_blank, así que
 *      arranca sin historia— usamos el `referrer` del mismo origen: te devuelve a
 *      la página del portal desde la que abriste.
 *   3. Sin ninguna pista (entrada directa desde Google) → la landing.
 * El `href="/"` es el fallback sin JS: si no hidrata, el enlace sigue llevando a
 * la home, que es lo razonable para un visitante público.
 */
export default function VolverLink() {
  const router = useRouter()

  function volver(e: React.MouseEvent) {
    e.preventDefault()
    if (typeof window === 'undefined') return

    if (window.history.length > 1) {
      router.back()
      return
    }
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
