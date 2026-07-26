'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { avisarNavegacion } from '@/components/portal/TopLoader'
import { IconoSeveridad, TiempoRelativo } from '@/components/portal/notificaciones/presentacion'
import { useAvisos } from './AvisosContext'
import type { AvisoAdminFila } from '@/app/actions/admin/notificaciones'

// Campana de la cabecera del admin. Misma pieza que la del portal: reutiliza sus
// clases `.ntf-*` (que son genéricas, no del portal) y sus dos componentes de
// presentación —icono por severidad y tiempo relativo— para que un aviso se lea
// igual en los dos paneles. Lo único propio son las acciones del servidor.
export default function AvisosCampana() {
  const { noLeidas, recientes, leer, leerTodas } = useAvisos()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Cerrar al hacer clic fuera o con Escape.
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

  async function abrir(a: AvisoAdminFila) {
    setOpen(false)
    if (a.enlace) avisarNavegacion()
    if (a.estado === 'nueva') await leer(a.id)
    if (a.enlace) router.push(a.enlace)
  }

  return (
    <div className="ntf-campana" ref={ref}>
      <button
        type="button"
        className="theme-toggle-btn ntf-campana-btn"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={noLeidas > 0 ? `Avisos (${noLeidas} sin leer)` : 'Avisos'}
      >
        <Bell size={18} strokeWidth={2} />
        {noLeidas > 0 && (
          <span className="ntf-badge" aria-hidden="true">{noLeidas > 9 ? '9+' : noLeidas}</span>
        )}
      </button>

      {open && (
        <div className="ntf-panel" role="menu">
          <div className="ntf-panel-header">
            <span className="ntf-panel-titulo">Avisos</span>
            {noLeidas > 0 && (
              <button type="button" className="ntf-panel-accion" onClick={() => void leerTodas()}>
                Marcar todos como leídos
              </button>
            )}
          </div>

          <div className="ntf-panel-lista">
            {recientes.length === 0 ? (
              <p className="ntf-vacio">No hay avisos.</p>
            ) : (
              recientes.map(a => (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  className={`ntf-item ntf-sev-${a.severidad}${a.estado === 'nueva' ? ' ntf-item-nueva' : ''}`}
                  onClick={() => void abrir(a)}
                >
                  <span className="ntf-item-icono"><IconoSeveridad severidad={a.severidad} /></span>
                  <span className="ntf-item-cuerpo">
                    <span className="ntf-item-linea">
                      {a.estado === 'nueva' && <span className="ntf-punto" aria-hidden="true" />}
                      <span className="ntf-item-titulo">{a.titulo}</span>
                    </span>
                    <TiempoRelativo iso={a.created_at} />
                  </span>
                </button>
              ))
            )}
          </div>

          <Link
            href="/admin/notificaciones"
            className="ntf-panel-pie"
            onClick={() => setOpen(false)}
          >
            Ver todos
          </Link>
        </div>
      )}
    </div>
  )
}
