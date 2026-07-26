'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  listarAvisos, contarAvisosNoLeidos, popupsAvisosPendientes,
  marcarAvisoLeido, marcarAvisosTodosLeidos, archivarAviso, marcarPopupAvisoMostrado,
  type AvisoAdminFila,
} from '@/app/actions/admin/notificaciones'

// Estado compartido de la campana y los popups del panel interno. Espejo de
// NotificacionesContext del portal: un solo proveedor para que haya UN refresco y
// un solo contador (dos suscripciones darían el doble de peticiones y contadores
// que discrepan cuando el cron inserta en ráfaga).

interface Ctx {
  noLeidas:    number
  recientes:   AvisoAdminFila[]
  popups:      AvisoAdminFila[]
  leer:        (id: number) => Promise<void>
  leerTodas:   () => Promise<void>
  archivar:    (id: number) => Promise<void>
  cerrarPopup: (id: number) => void
  /** Recarga contador, lista y popups. Lo usan las acciones en lote de la bandeja. */
  refrescar:   () => Promise<void>
}

const AvisosCtx = createContext<Ctx | null>(null)

export function useAvisos(): Ctx {
  const ctx = useContext(AvisosCtx)
  if (!ctx) throw new Error('useAvisos fuera de <AvisosProvider>')
  return ctx
}

/** Tiempo mínimo entre dos refrescos por volver a la pestaña. */
const MS_ENTRE_REFRESCOS = 60_000

interface Props {
  /** Carga inicial desde el servidor: la campana ya nace con su contador puesto. */
  inicial:  { noLeidas: number; recientes: AvisoAdminFila[]; popups: AvisoAdminFila[] }
  children: React.ReactNode
}

export function AvisosProvider({ inicial, children }: Props) {
  const [noLeidas,  setNoLeidas]  = useState(inicial.noLeidas)
  const [recientes, setRecientes] = useState(inicial.recientes)
  const [popups,    setPopups]    = useState(inicial.popups)
  // Arranca en 0 y se sella dentro del efecto: `Date.now()` en el cuerpo del
  // componente es una llamada impura durante el render y React 19 lo marca.
  const ultimoRef   = useRef<number>(0)
  // Popups cerrados a mano en esta sesión (los urgentes reaparecen al recargar,
  // que es lo suyo, pero no en el mismo rato).
  const cerradosRef = useRef<Set<number>>(new Set())

  const refrescar = useCallback(async () => {
    const [n, r, p] = await Promise.all([
      contarAvisosNoLeidos(),
      listarAvisos('todas', 8),
      popupsAvisosPendientes(),
    ])
    setNoLeidas(n)
    setRecientes(r)
    setPopups(prev => {
      const cerrados = new Set(cerradosRef.current)
      return p.filter(x => !cerrados.has(x.id) || prev.some(y => y.id === x.id))
    })
  }, [])

  // Refresco al volver a la pestaña, no por websocket. Aquí Realtime SÍ sería
  // viable (el admin usa Supabase Auth, a diferencia del portal), pero el cron
  // corre una vez al día: no se paga una conexión abierta para eso.
  useEffect(() => {
    ultimoRef.current = Date.now()

    function alVolver() {
      if (document.visibilityState !== 'visible') return
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
    if (pendientes.length > 0) void marcarPopupAvisoMostrado(pendientes)
  }, [popups])

  const leer = useCallback(async (id: number) => {
    setNoLeidas(n => Math.max(0, n - 1))
    setRecientes(rs => rs.map(r => (r.id === id ? { ...r, estado: 'leida' as const } : r)))
    setPopups(ps => ps.filter(p => p.id !== id))
    await marcarAvisoLeido(id)
    void refrescar()
  }, [refrescar])

  const leerTodas = useCallback(async () => {
    setNoLeidas(0)
    setRecientes(rs => rs.map(r => (r.estado === 'nueva' ? { ...r, estado: 'leida' as const } : r)))
    setPopups([])
    await marcarAvisosTodosLeidos()
    void refrescar()
  }, [refrescar])

  const archivar = useCallback(async (id: number) => {
    setRecientes(rs => rs.filter(r => r.id !== id))
    setPopups(ps => ps.filter(p => p.id !== id))
    await archivarAviso(id)
    void refrescar()
  }, [refrescar])

  const cerrarPopup = useCallback((id: number) => {
    cerradosRef.current.add(id)
    setPopups(ps => ps.filter(p => p.id !== id))
  }, [])

  return (
    <AvisosCtx.Provider
      value={{ noLeidas, recientes, popups, leer, leerTodas, archivar, cerrarPopup, refrescar }}
    >
      {children}
    </AvisosCtx.Provider>
  )
}
