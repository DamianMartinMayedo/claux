'use client'

import { useEffect, useRef } from 'react'

// Registra el service worker del punto de venta con scope acotado a /punto-de-venta (no
// todo el sitio). Silencioso si el navegador no soporta SW (degrada a online normal).
//
// **SIN barra final, y es la diferencia entre funcionar sin conexión o no.** El ámbito de
// un service worker es un PREFIJO DE CADENA: con `/punto-de-venta/`, la URL
// `/punto-de-venta?c=CAJ-…` —que es la `start_url` del manifest, o sea por donde arranca la
// app YA INSTALADA— no empieza por ese prefijo y el SW no la controla. El respaldo de
// navegación del propio SW tampoco podía existir jamás en caché, porque su handler no
// llegaba a ejecutarse para esa URL. Resultado: el icono de la pantalla de inicio, que es
// el único camino real de uso, se quedaba sin la caché que hace de esto una caja offline.
// El enlace de instalación (`/punto-de-venta/<slug>?c=…`) sí caía dentro, y por eso en el
// navegador parecía ir bien.
//
// Auto-actualización: al abrir la app busca una versión nueva del SW; cuando una
// versión nueva toma el control (tras un deploy), recarga UNA vez para servir el
// código más reciente. No recarga en la primera instalación (no había controlador).
//
// **Pero no recarga con trabajo a medias.** Una recarga que el usuario no pidió se llevaba
// el carrito de la venta en curso. El carrito se persiste (`punto-venta-db`), y aun así la
// recarga espera: la caja avisa cuando puede aplicarse, y si no, se aplica al reabrir.
export default function PuntoVentaPwaRegister({ ocupado = false }: { ocupado?: boolean }) {
  // Ref y no dependencia: el oyente se registra UNA vez y tiene que leer el estado de ahora.
  const ocupadoRef = useRef(ocupado)
  ocupadoRef.current = ocupado

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const hadController = !!navigator.serviceWorker.controller
    let refreshing = false

    const onControllerChange = () => {
      if (refreshing || !hadController) return
      if (ocupadoRef.current) return   // hay una venta a medias: la versión nueva espera
      refreshing = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    navigator.serviceWorker.register('/sw-punto-de-venta.js', { scope: '/punto-de-venta' })
      .then(reg => { reg.update().catch(() => {}) })
      .catch(() => {})

    // Al volver a la app (reabrir la PWA), comprobar si hay versión nueva.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      navigator.serviceWorker.getRegistration('/punto-de-venta').then(r => r?.update()).catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}
