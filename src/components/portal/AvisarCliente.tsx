'use client'

import { MessageCircle, Phone, Send } from 'lucide-react'
import { enlaceAviso, textoAviso, type DatosAviso } from '@/lib/reservas/avisar'

/**
 * «Avisar al cliente»: abre el chat con el mensaje ya escrito.
 *
 * CLAUX no le manda correos al cliente final del negocio, así que el aviso lo da el
 * dueño — pero con el texto redactado y el chat abierto, que es donde estaba todo el
 * trabajo. No hay envío automático ni registro de entrega: es él escribiendo.
 */
export default function AvisarCliente({ datos, telefono, chatTelegram, compacto }: {
  datos:        DatosAviso
  telefono:     string | null
  chatTelegram: string | null
  /** `true` = item de `RowActions`; `false` = botón del pie de un modal. */
  compacto?:    boolean
}) {
  const destino = enlaceAviso(telefono, chatTelegram, textoAviso(datos))
  // Sin teléfono ni chat no hay a dónde escribir, y un botón que no lleva a ningún
  // sitio es peor que no tenerlo.
  if (!destino) return null

  const Icono = destino.canal === 'whatsapp' ? MessageCircle : destino.canal === 'telegram' ? Send : Phone
  const label = destino.canal === 'llamada' ? 'Llamar al cliente' : 'Avisar al cliente'

  return (
    <a
      className={compacto ? 'row-actions-item' : 'btn btn-secondary btn-sm'}
      href={destino.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
    >
      <Icono size={compacto ? 15 : 14} strokeWidth={2} /> {label}
    </a>
  )
}
