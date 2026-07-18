'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { useNotificaciones } from './NotificacionesContext'
import { IconoSeveridad } from './presentacion'
import type { NotificacionFila } from '@/app/actions/portal/notificaciones'

// Avisos flotantes, arriba a la derecha (el toast de acciones ocupa arriba-centro
// y el chat de IA la esquina de abajo). Dos comportamientos:
//  · aviso   — se autocierra a los 6 s y no vuelve a salir.
//  · urgente — no se autocierra; vuelve a aparecer mientras siga sin leer.
const MS_AUTOCIERRE = 6000

export default function NotificacionesPopups() {
  const { popups } = useNotificaciones()
  if (popups.length === 0) return null

  return (
    <div className="ntf-popups" role="status" aria-live="polite">
      {popups.map(n => <Popup key={n.id} n={n} />)}
    </div>
  )
}

function Popup({ n }: { n: NotificacionFila }) {
  const { leer, cerrarPopup } = useNotificaciones()
  const router = useRouter()
  const urgente = n.severidad === 'urgente'

  useEffect(() => {
    if (urgente) return
    const t = setTimeout(() => cerrarPopup(n.id), MS_AUTOCIERRE)
    return () => clearTimeout(t)
  }, [urgente, n.id, cerrarPopup])

  async function ir() {
    await leer(n.id)
    if (n.enlace) router.push(n.enlace)
  }

  return (
    <div className={`ntf-popup ntf-sev-${n.severidad}`}>
      <span className="ntf-popup-icono"><IconoSeveridad severidad={n.severidad} size={18} /></span>
      <div className="ntf-popup-cuerpo">
        <p className="ntf-popup-titulo">{n.titulo}</p>
        {n.cuerpo && <p className="ntf-popup-texto">{n.cuerpo}</p>}
        {n.enlace && (
          <button type="button" className="ntf-popup-accion" onClick={() => void ir()}>
            Ver detalle
          </button>
        )}
      </div>
      <button
        type="button"
        className="ntf-popup-cerrar"
        onClick={() => (urgente ? void leer(n.id) : cerrarPopup(n.id))}
        aria-label={urgente ? 'Marcar como leída' : 'Cerrar aviso'}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
