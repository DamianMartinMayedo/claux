'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  listarNotificaciones, contarNoLeidas, popupsPendientes,
  marcarLeida, marcarTodasLeidas, archivarNotificacion, marcarPopupMostrado,
  type NotificacionFila,
} from '@/app/actions/portal/notificaciones'

// Estado compartido de la campana y de los popups. Un solo proveedor para que
// haya UNA suscripción de Realtime y un solo refresco: si cada componente
// mantuviera la suya, el cron (que inserta en ráfaga) dispararía el doble de
// refetches y los dos contadores podrían discrepar.

interface Ctx {
  noLeidas:   number
  recientes:  NotificacionFila[]
  popups:     NotificacionFila[]
  leer:       (id: number) => Promise<void>
  leerTodas:  () => Promise<void>
  archivar:   (id: number) => Promise<void>
  cerrarPopup:(id: number) => void
}

const NotificacionesCtx = createContext<Ctx | null>(null)

export function useNotificaciones(): Ctx {
  const ctx = useContext(NotificacionesCtx)
  if (!ctx) throw new Error('useNotificaciones fuera de <NotificacionesProvider>')
  return ctx
}

/** Tiempo mínimo entre dos refrescos por volver a la pestaña. */
const MS_ENTRE_REFRESCOS = 60_000

interface Props {
  /** Carga inicial desde el servidor: la campana ya nace con su contador puesto. */
  inicial:   { noLeidas: number; recientes: NotificacionFila[]; popups: NotificacionFila[] }
  children:  React.ReactNode
}

export function NotificacionesProvider({ inicial, children }: Props) {
  const [noLeidas,  setNoLeidas]  = useState(inicial.noLeidas)
  const [recientes, setRecientes] = useState(inicial.recientes)
  const [popups,    setPopups]    = useState(inicial.popups)
  const ultimoRef = useRef<number>(Date.now())

  const refrescar = useCallback(async () => {
    const [n, r, p] = await Promise.all([
      contarNoLeidas(),
      listarNotificaciones('todas', 8),
      popupsPendientes(),
    ])
    setNoLeidas(n)
    setRecientes(r)
    // No reabrimos un popup que el usuario acaba de cerrar en esta sesión.
    setPopups(prev => {
      const cerrados = new Set(cerradosRef.current)
      return p.filter(x => !cerrados.has(x.id) || prev.some(y => y.id === x.id))
    })
  }, [])

  // Popups cerrados a mano en esta sesión (los urgentes reaparecen al recargar,
  // que es justo lo que se espera de ellos, pero no en el mismo rato).
  const cerradosRef = useRef<Set<number>>(new Set())

  // Refresco al volver a la pestaña (no por websocket: ver el comentario de la
  // migración 109 — Realtime se suscribiría como `anon` y nunca recibiría nada).
  // Es además lo que encaja con la conexión cubana: cero tráfico mientras el
  // portal está en segundo plano, y los avisos al día en cuanto se vuelve a él.
  useEffect(() => {
    function alVolver() {
      if (document.visibilityState !== 'visible') return
      // El cron corre una vez al día: no tiene sentido repreguntar cada rato.
      if (Date.now() - ultimoRef.current < MS_ENTRE_REFRESCOS) return
      ultimoRef.current = Date.now()
      void refrescar()
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [refrescar])

  // Marcar como mostrados los popups visibles (el de tipo `aviso` sale una vez).
  useEffect(() => {
    const pendientes = popups.filter(p => !p.popup_mostrado).map(p => p.id)
    if (pendientes.length > 0) void marcarPopupMostrado(pendientes)
  }, [popups])

  const leer = useCallback(async (id: number) => {
    setNoLeidas(n => Math.max(0, n - 1))
    setRecientes(rs => rs.map(r => (r.id === id ? { ...r, estado: 'leida' as const } : r)))
    setPopups(ps => ps.filter(p => p.id !== id))
    await marcarLeida(id)
    void refrescar()
  }, [refrescar])

  const leerTodas = useCallback(async () => {
    setNoLeidas(0)
    setRecientes(rs => rs.map(r => (r.estado === 'nueva' ? { ...r, estado: 'leida' as const } : r)))
    setPopups([])
    await marcarTodasLeidas()
    void refrescar()
  }, [refrescar])

  const archivar = useCallback(async (id: number) => {
    setRecientes(rs => rs.filter(r => r.id !== id))
    setPopups(ps => ps.filter(p => p.id !== id))
    await archivarNotificacion(id)
    void refrescar()
  }, [refrescar])

  const cerrarPopup = useCallback((id: number) => {
    cerradosRef.current.add(id)
    setPopups(ps => ps.filter(p => p.id !== id))
  }, [])

  return (
    <NotificacionesCtx.Provider
      value={{ noLeidas, recientes, popups, leer, leerTodas, archivar, cerrarPopup }}
    >
      {children}
    </NotificacionesCtx.Provider>
  )
}
