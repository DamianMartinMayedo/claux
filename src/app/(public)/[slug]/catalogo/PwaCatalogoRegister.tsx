'use client'

import { useEffect } from 'react'

// Registra el service worker del catálogo con scope acotado a ESTE negocio
// (`/<slug>/catalogo/`), no a todo el sitio: aunque el archivo se sirva desde
// la raíz, un scope acotado hace que el navegador solo lo consulte para páginas
// bajo esa ruta — el portal/admin nunca pasan por aquí. Silencioso si el
// navegador no soporta Service Workers (degrada a comportamiento normal online).
export default function PwaCatalogoRegister({ slug }: { slug: string }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw-catalogo.js', { scope: `/${slug}/catalogo/` })
      .catch(() => {})
  }, [slug])

  return null
}
