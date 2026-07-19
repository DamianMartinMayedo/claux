'use client'

import { useEffect } from 'react'

// Registra el service worker del punto de venta con scope /punto-de-venta/ (no todo el sitio).
// Silencioso si el navegador no soporta SW (degrada a online normal).
//
// Auto-actualización: al abrir la app busca una versión nueva del SW; cuando una
// versión nueva toma el control (tras un deploy), recarga UNA vez para servir el
// código más reciente. No recarga en la primera instalación (no había controlador).
export default function PuntoVentaPwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const hadController = !!navigator.serviceWorker.controller
    let refreshing = false

    const onControllerChange = () => {
      if (refreshing || !hadController) return
      refreshing = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    navigator.serviceWorker.register('/sw-punto-de-venta.js', { scope: '/punto-de-venta/' })
      .then(reg => { reg.update().catch(() => {}) })
      .catch(() => {})

    // Al volver a la app (reabrir la PWA), comprobar si hay versión nueva.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      navigator.serviceWorker.getRegistration('/punto-de-venta/').then(r => r?.update()).catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}
