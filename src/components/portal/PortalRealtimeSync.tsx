'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Suscripción Realtime a la fila del cliente en Supabase.
// Cuando el admin cambia estado, módulos o fecha_expiracion, el portal
// llama a router.refresh() para re-ejecutar los Server Components
// sin recargar la página completa.
export default function PortalRealtimeSync({ clientId }: { clientId: string }) {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`portal-sync-${clientId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'clients',
          filter: `client_id=eq.${clientId}`,
        },
        () => { router.refresh() },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [clientId, router])

  return null
}
