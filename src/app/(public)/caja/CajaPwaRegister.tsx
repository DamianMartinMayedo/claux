'use client'

import { useEffect } from 'react'

// Registra el service worker de la caja con scope /caja/ (no todo el sitio).
// Silencioso si el navegador no soporta SW (degrada a online normal).
export default function CajaPwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw-caja.js', { scope: '/caja/' }).catch(() => {})
  }, [])
  return null
}
