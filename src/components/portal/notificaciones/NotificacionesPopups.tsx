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

// Cuántos popups se apilan antes de resumirlos. El cron crea en ráfaga: un
// negocio con la contabilidad al día puede amanecer con diez cobros vencidos, y
// diez tarjetas rojas tapando media pantalla no se leen, se cierran de golpe.
// Pasado el tope se muestra UNA que lleva al centro de notificaciones.
const MAX_POPUPS = 3

export default function NotificacionesPopups() {
  const { popups } = useNotificaciones()
  if (popups.length === 0) return null

  return (
    <div className="ntf-popups" role="status" aria-live="polite">
      {popups.length > MAX_POPUPS
        ? <PopupResumen />
        : popups.map(n => <Popup key={n.id} n={n} />)}
    </div>
  )
}

/** Muchos avisos a la vez: uno solo que los cuenta y lleva a la bandeja. */
function PopupResumen() {
  const { popups, noLeidas, leerTodas } = useNotificaciones()
  const router = useRouter()
  // El total sale del contador de la campana, no de `popups`: esa lista viene
  // acotada por el servidor y diría "3" habiendo doce.
  const total    = noLeidas
  const urgentes = popups.filter(p => p.severidad === 'urgente').length

  return (
    <div className={`ntf-popup ntf-sev-${urgentes > 0 ? 'urgente' : 'aviso'}`}>
      <span className="ntf-popup-icono">
        <IconoSeveridad severidad={urgentes > 0 ? 'urgente' : 'aviso'} size={18} />
      </span>
      <div className="ntf-popup-cuerpo">
        <p className="ntf-popup-titulo">Tienes {total} avisos sin leer</p>
        <p className="ntf-popup-texto">
          {urgentes > 0
            ? `Al menos ${urgentes} ${urgentes === 1 ? 'necesita' : 'necesitan'} tu atención.`
            : 'Revísalos cuando puedas.'}
        </p>
        <button
          type="button"
          className="ntf-popup-accion"
          onClick={() => router.push('/portal/notificaciones')}
        >
          Verlos todos
        </button>
      </div>
      <button
        type="button"
        className="ntf-popup-cerrar"
        onClick={() => void leerTodas()}
        aria-label="Marcar todo como leído"
      >
        <X size={14} strokeWidth={2} />
      </button>
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
