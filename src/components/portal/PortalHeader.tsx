'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User, UsersRound, Building2, DollarSign, CreditCard, HelpCircle, Sun, Moon, Bell } from 'lucide-react'
import type { PortalSession } from '@/lib/portal-auth'
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
}

// Iniciales del negocio: primera letra de la primera y la última palabra.
function inicialesNegocio(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return '?'
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase()
  return (palabras[0][0] + palabras[palabras.length - 1][0]).toUpperCase()
}

export default function PortalHeader({ session, nombreEmpresa, empresas }: Props) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [tema, setTema] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    setTema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  }, [])

  function toggleTema() {
    const next = tema === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('claux-theme', next)
    setTema(next)
  }

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

  // Opciones de cuenta (antes el grupo «Configuración» del sidebar).
  const opciones = [
    { ruta: '/portal/perfil',      label: 'Mi perfil',    icon: <User size={16} strokeWidth={2} /> },
    ...(session.rol === 'admin_empresa'
      ? [
          { ruta: '/portal/notificaciones', label: 'Notificaciones', icon: <Bell size={16} strokeWidth={2} /> },
          { ruta: '/portal/usuarios', label: 'Usuarios', icon: <UsersRound size={16} strokeWidth={2} /> },
        ]
      : []),
    { ruta: '/portal/empresas',    label: 'Mis Empresas', icon: <Building2 size={16} strokeWidth={2} /> },
    { ruta: '/portal/monedas',     label: 'Monedas y tasas', icon: <DollarSign size={16} strokeWidth={2} /> },
    { ruta: '/portal/facturacion', label: 'Suscripción',  icon: <CreditCard size={16} strokeWidth={2} /> },
    { ruta: '/portal/soporte',     label: 'Soporte',      icon: <HelpCircle size={16} strokeWidth={2} /> },
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
        {session.rol === 'admin_empresa' && <NotificacionesCampana />}
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
                {opciones.map(o => {
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
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
