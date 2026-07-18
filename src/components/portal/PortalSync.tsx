'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

// Propaga al portal los cambios que hace el admin sobre el cliente (estado,
// módulos contratados, fecha_expiracion) sin obligar a recargar a mano.
//
// Antes esto era una suscripción de Supabase Realtime (`PortalRealtimeSync`) y
// NO funcionaba: `postgres_changes` entrega los eventos filtrados por las
// políticas RLS del rol que se suscribe, y el navegador del portal se conecta
// con la clave anon (sus usuarios son `client_users` con JWT propio, no Supabase
// Auth). La tabla `clients` solo tiene policy para `authenticated`, así que el
// canal llegaba a SUBSCRIBED —parecía sano— y no recibía un solo evento nunca.
// Comprobado A/B contra la BD real: anon 0 eventos, service_role 1.
// Arreglarlo con una policy de SELECT para `anon` no es opción: expondría la
// fila de todos los tenants a una clave que viaja en el navegador.
//
// Así que se refresca al volver a la pestaña. Cubre el caso real (el dueño deja
// el portal abierto mientras le activan un módulo) y, a diferencia del
// websocket, no cuesta nada mientras la pestaña está en segundo plano — que es
// lo que pide la conexión cubana (CONTEXTO §7). Cualquier navegación normal ya
// releía el estado: el layout es dinámico.
//
// Mismo patrón que NotificacionesContext.

/** Tiempo mínimo entre dos refrescos por volver a la pestaña. */
const MS_ENTRE_REFRESCOS = 60_000

export default function PortalSync() {
  const router = useRouter()
  const ultimoRef = useRef<number>(Date.now())

  useEffect(() => {
    function alVolver() {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - ultimoRef.current < MS_ENTRE_REFRESCOS) return
      ultimoRef.current = Date.now()
      router.refresh()
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [router])

  return null
}
