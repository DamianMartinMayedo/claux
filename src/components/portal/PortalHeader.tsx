'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User, UsersRound, Building2, DollarSign, CreditCard, HelpCircle, Sun, Moon, LogOut } from 'lucide-react'
import type { PortalSession } from '@/lib/portal-auth'
import { logoutCliente } from '@/app/actions/portal/auth'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { empresaColorVar } from './EmpresaTag'
import MobileNavToggle from '@/components/MobileNavToggle'
import NotificacionesCampana from './notificaciones/NotificacionesCampana'

interface EmpresaLite {
  empresa_id: string
  nombre:     string
  color?:     string | null
}

interface Props {
  session:       PortalSession
  nombreEmpresa: string
  empresas:      EmpresaLite[]
  /**
   * Si hay bandeja de notificaciones en esta sesión. Lo decide el layout, que es quien
   * monta el `<NotificacionesProvider>`, y **viaja como prop en vez de recalcularse aquí**:
   * la campana comprobaba `rol === 'admin_empresa'` y el layout `rol === 'admin_empresa' &&
   * !bloqueado`. Con el portal bloqueado (cliente desactivado, vencido o fuera de gracia) la
   * campana se pintaba sin proveedor y el `useNotificaciones` reventaba el layout entero:
   * el admin de un cliente bloqueado no veía la pantalla de bloqueo, veía «This page
   * couldn't load». Dos condiciones que tienen que ser la misma, ahora son una.
   */
  verNotificaciones: boolean
}

// Iniciales del negocio: primera letra de la primera y la última palabra.
function inicialesNegocio(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return '?'
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase()
  return (palabras[0][0] + palabras[palabras.length - 1][0]).toUpperCase()
}

export default function PortalHeader({ session, nombreEmpresa, empresas, verNotificaciones }: Props) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [tema, setTema] = useState<'light' | 'dark'>('light')
  const [, startTransition] = useTransition()
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)

  useEffect(() => {
    setTema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
    // Sincronía entre pestañas: si el tema cambia en otra pestaña, esta se entera por el
    // evento `storage` (solo se dispara en las demás pestañas, no en la que escribe) y se
    // pone al día sin recargar. Sin esto, dos pestañas abiertas divergían de tema.
    function onStorage(e: StorageEvent) {
      if (e.key !== 'claux-theme' || !e.newValue) return
      const next = e.newValue === 'dark' ? 'dark' : 'light'
      document.documentElement.setAttribute('data-theme', next)
      setTema(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function toggleTema() {
    const next = tema === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('claux-theme', next)
    setTema(next)
  }

  function confirmLogout() { startTransition(() => { logoutCliente() }) }

  // Una sola empresa → su color es la identidad de la cuenta: tiñe el avatar.
  // Varias → el grupo no tiene un color único; avatar neutro + leyenda en el menú.
  const empresaUnica = empresas.length === 1 ? empresas[0] : null

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

  // Opciones de cuenta, agrupadas (antes el grupo «Configuración» del sidebar).
  // «Empresas», «Usuarios» y «Mi plan CLAUX» son cosa del dueño: se ocultan a un `usuario`
  // no-admin (el candado real de cada página vive en su server guard). «Monedas» se queda:
  // hasta solo-lectura puede actualizar tasas.
  const esAdmin = session.rol === 'admin_empresa'
  type Opcion = { ruta: string; label: string; icon: React.ReactNode }
  const grupos: { titulo: string; items: Opcion[] }[] = [
    {
      titulo: 'Mi cuenta',
      items: [
        { ruta: '/portal/perfil',  label: 'Mi perfil', icon: <User size={16} strokeWidth={2} /> },
        { ruta: '/portal/soporte', label: 'Soporte',   icon: <HelpCircle size={16} strokeWidth={2} /> },
      ],
    },
    {
      titulo: 'Negocio',
      items: [
        ...(esAdmin ? [{ ruta: '/portal/empresas', label: 'Empresas', icon: <Building2 size={16} strokeWidth={2} /> }] : []),
        { ruta: '/portal/monedas', label: 'Monedas y tasas', icon: <DollarSign size={16} strokeWidth={2} /> },
        ...(esAdmin ? [{ ruta: '/portal/usuarios', label: 'Usuarios', icon: <UsersRound size={16} strokeWidth={2} /> }] : []),
        ...(esAdmin ? [{ ruta: '/portal/facturacion', label: 'Mi plan CLAUX', icon: <CreditCard size={16} strokeWidth={2} /> }] : []),
      ],
    },
  ]

  return (
    <header className="portal-header">
      <div className="portal-header-left">
        <MobileNavToggle shellSelector=".portal-shell" navId="portal-nav" />
        <Link href="/portal/dashboard" className="portal-logo">
          <img src="/logo_color.svg" alt="CLAUX" className="logo-light" />
          <img src="/logo_blanco.svg" alt="CLAUX" className="logo-dark" />
        </Link>
      </div>
      <div className="portal-header-right">
        {/* La bandeja es del negocio y compartida: solo la ven sus administradores. */}
        {verNotificaciones && <NotificacionesCampana />}
        <button
          type="button"
          className="theme-toggle-btn"
          onClick={toggleTema}
          aria-label={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          title={tema === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        >
          {tema === 'dark' ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
        </button>
        <div className="portal-header-account" ref={ref}>
          <button
            type="button"
            className={`portal-header-avatar${empresaUnica ? ' empresa-tinted' : ''}`}
            style={empresaUnica ? empresaColorVar(empresaUnica.color) : undefined}
            onClick={() => setOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Menú de cuenta"
          >
            {inicialesNegocio(nombreEmpresa)}
          </button>

          {open && (
            <div className="portal-account-menu" role="menu">
              <div className="portal-account-menu-header">
                <span className="portal-account-menu-empresa">{nombreEmpresa}</span>
                <span className="portal-account-menu-email">{session.email}</span>
              </div>
              <div className="portal-account-menu-list">
                {grupos.map((g, gi) => (
                  <div key={g.titulo} className="portal-account-menu-group">
                    {gi > 0 && <div className="portal-account-menu-sep" />}
                    <span className="portal-account-menu-group-label">{g.titulo}</span>
                    {g.items.map(o => {
                      const active = pathname === o.ruta || pathname.startsWith(o.ruta + '/')
                      return (
                        <Link
                          key={o.ruta}
                          href={o.ruta}
                          role="menuitem"
                          onClick={() => setOpen(false)}
                          className={`portal-account-menu-item${active ? ' active' : ''}`}
                        >
                          {o.icon}
                          <span>{o.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                ))}
                <div className="portal-account-menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="portal-account-menu-item portal-account-menu-logout"
                  onClick={() => { setOpen(false); setShowLogoutDialog(true) }}
                >
                  <LogOut size={16} strokeWidth={2} />
                  <span>Cerrar sesión</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showLogoutDialog && (
        <ConfirmDialog
          title="Cerrar sesión"
          body="¿Estás seguro de que deseas cerrar sesión?"
          confirmLabel="Cerrar sesión"
          danger
          onConfirm={confirmLogout}
          onCancel={() => setShowLogoutDialog(false)}
        />
      )}
    </header>
  )
}
