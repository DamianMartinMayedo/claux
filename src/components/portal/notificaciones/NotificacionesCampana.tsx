'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { avisarNavegacion } from '@/components/portal/TopLoader'
import { useNotificaciones } from './NotificacionesContext'
import { IconoSeveridad, TiempoRelativo } from './presentacion'
import type { NotificacionFila } from '@/app/actions/portal/notificaciones'

// Campana de la cabecera del portal. Solo la monta el layout para admin_empresa:
// la bandeja es del negocio, no de cada usuario.
export default function NotificacionesCampana() {
  const { noLeidas, recientes, leer, leerTodas } = useNotificaciones()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Cerrar al hacer clic fuera o con Escape (mismo patrón que el menú de cuenta).
  useEffect(() => {
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  async function abrir(n: NotificacionFila) {
    setOpen(false)
    if (n.enlace) avisarNavegacion()
    if (n.estado === 'nueva') await leer(n.id)
    if (n.enlace) router.push(n.enlace)
  }

  return (
    <div className="ntf-campana" ref={ref}>
      <button
        type="button"
        className="theme-toggle-btn ntf-campana-btn"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={noLeidas > 0 ? `Notificaciones (${noLeidas} sin leer)` : 'Notificaciones'}
      >
        <Bell size={18} strokeWidth={2} />
        {noLeidas > 0 && (
          <span className="ntf-badge" aria-hidden="true">{noLeidas > 9 ? '9+' : noLeidas}</span>
        )}
      </button>

      {open && (
        <div className="ntf-panel" role="menu">
          <div className="ntf-panel-header">
            <span className="ntf-panel-titulo">Notificaciones</span>
            {noLeidas > 0 && (
              <button type="button" className="ntf-panel-accion" onClick={() => void leerTodas()}>
                Marcar todas como leídas
              </button>
            )}
          </div>

          <div className="ntf-panel-lista">
            {recientes.length === 0 ? (
              <p className="ntf-vacio">No tienes notificaciones.</p>
            ) : (
              recientes.map(n => (
                <button
                  key={n.id}
                  type="button"
                  role="menuitem"
                  className={`ntf-item ntf-sev-${n.severidad}${n.estado === 'nueva' ? ' ntf-item-nueva' : ''}`}
                  onClick={() => void abrir(n)}
                >
                  <span className="ntf-item-icono"><IconoSeveridad severidad={n.severidad} /></span>
                  <span className="ntf-item-cuerpo">
                    <span className="ntf-item-linea">
                      {n.estado === 'nueva' && <span className="ntf-punto" aria-hidden="true" />}
                      <span className="ntf-item-titulo">{n.titulo}</span>
                    </span>
                    <TiempoRelativo iso={n.created_at} />
                  </span>
                </button>
              ))
            )}
          </div>

          <Link
            href="/portal/notificaciones"
            className="ntf-panel-pie"
            onClick={() => setOpen(false)}
          >
            Ver todas
          </Link>
        </div>
      )}
    </div>
  )
}
