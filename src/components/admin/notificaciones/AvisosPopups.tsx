'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { avisarNavegacion } from '@/components/portal/TopLoader'
import { IconoSeveridad } from '@/components/portal/notificaciones/presentacion'
import { useAvisos } from './AvisosContext'
import type { AvisoAdminFila } from '@/app/actions/admin/notificaciones'

// Avisos flotantes del panel interno, arriba a la derecha. Mismo contrato que en
// el portal:
//  · aviso   — se autocierra a los 6 s y no vuelve a salir.
//  · urgente — no se autocierra; reaparece mientras siga sin leer.
const MS_AUTOCIERRE = 6000

// Pasado este tope se muestra UNO que los resume: el cron puede crear en ráfaga
// (cinco clientes vencidos el mismo día) y cinco tarjetas rojas tapando la
// pantalla no se leen, se cierran de golpe.
const MAX_POPUPS = 3

export default function AvisosPopups() {
  const { popups } = useAvisos()
  const pathname = usePathname()

  // En la propia bandeja no sale ninguno: el usuario ya está mirando la lista.
  if (pathname.startsWith('/admin/notificaciones')) return null
  if (popups.length === 0) return null

  return (
    <div className="ntf-popups" role="status" aria-live="polite">
      {popups.length > MAX_POPUPS
        ? <PopupResumen />
        : popups.map(a => <Popup key={a.id} a={a} />)}
    </div>
  )
}

/** Muchos avisos a la vez: uno solo que los cuenta y lleva a la bandeja. */
function PopupResumen() {
  const { popups, noLeidas, leerTodas } = useAvisos()
  const router = useRouter()
  // El total sale del contador, no de `popups`: esa lista viene acotada por el
  // servidor y diría "3" habiendo doce.
  const urgentes = popups.filter(p => p.severidad === 'urgente').length

  return (
    <div className={`ntf-popup ntf-sev-${urgentes > 0 ? 'urgente' : 'aviso'}`}>
      <span className="ntf-popup-icono">
        <IconoSeveridad severidad={urgentes > 0 ? 'urgente' : 'aviso'} size={18} />
      </span>
      <div className="ntf-popup-cuerpo">
        <p className="ntf-popup-titulo">Tienes {noLeidas} avisos sin leer</p>
        <p className="ntf-popup-texto">
          {urgentes > 0
            ? `Al menos ${urgentes} ${urgentes === 1 ? 'necesita' : 'necesitan'} atención hoy.`
            : 'Revísalos cuando puedas.'}
        </p>
        <button
          type="button"
          className="ntf-popup-accion"
          onClick={() => { avisarNavegacion(); router.push('/admin/notificaciones') }}
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

function Popup({ a }: { a: AvisoAdminFila }) {
  const { leer, cerrarPopup } = useAvisos()
  const router = useRouter()
  const urgente = a.severidad === 'urgente'

  useEffect(() => {
    if (urgente) return
    const t = setTimeout(() => cerrarPopup(a.id), MS_AUTOCIERRE)
    return () => clearTimeout(t)
  }, [urgente, a.id, cerrarPopup])

  async function ir() {
    if (a.enlace) avisarNavegacion()
    await leer(a.id)
    if (a.enlace) router.push(a.enlace)
  }

  return (
    <div className={`ntf-popup ntf-sev-${a.severidad}`}>
      <span className="ntf-popup-icono"><IconoSeveridad severidad={a.severidad} size={18} /></span>
      <div className="ntf-popup-cuerpo">
        <p className="ntf-popup-titulo">{a.titulo}</p>
        {a.cuerpo && <p className="ntf-popup-texto">{a.cuerpo}</p>}
        {a.enlace && (
          <button type="button" className="ntf-popup-accion" onClick={() => void ir()}>
            Ver detalle
          </button>
        )}
      </div>
      <button
        type="button"
        className="ntf-popup-cerrar"
        onClick={() => (urgente ? void leer(a.id) : cerrarPopup(a.id))}
        aria-label={urgente ? 'Marcar como leído' : 'Cerrar aviso'}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
