'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, Clock, GraduationCap, LogOut, Moon, Settings, Sun, User, UserCog } from 'lucide-react'
import MobileNavToggle from '@/components/MobileNavToggle'
import AvisosCampana from '@/components/admin/notificaciones/AvisosCampana'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { createClient } from '@/lib/supabase/client'
import { paginasCuentaVisibles, GRUPOS_CUENTA } from '@/lib/admin/paginas-cuenta'
import { ROL_LABEL, puedeAcceder, type RolAdmin, type SeccionKey } from '@/lib/roles'

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

const ICONOS: Record<string, React.ReactNode> = {
  '/admin/perfil':         <User size={16} strokeWidth={2} />,
  '/admin/usuarios':       <UserCog size={16} strokeWidth={2} />,
  '/admin/configuracion':  <Settings size={16} strokeWidth={2} />,
  '/admin/notificaciones': <Bell size={16} strokeWidth={2} />,
  '/admin/actividad':      <Clock size={16} strokeWidth={2} />,
}

export default function Header({
  displayName, rol, permisos, email,
}: {
  displayName: string
  rol: RolAdmin
  permisos: SeccionKey[]
  email: string
}) {
  const pathname = usePathname()
  const router   = useRouter()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [tema, setTema] = useState<'light' | 'dark'>('light')
  const [cerrando, startTransition] = useTransition()
  const [confirmarSalida, setConfirmarSalida] = useState(false)

  useEffect(() => {
    setTema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
    // Sincronía entre pestañas: si el tema cambia en otra, esta se entera por el evento
    // `storage` (que solo se dispara en las DEMÁS pestañas, no en la que escribe) y se
    // pone al día sin recargar. Mismo trato que el portal: es la misma persona.
    function onStorage(e: StorageEvent) {
      if (e.key !== 'claux-theme' || !e.newValue) return
      const next = e.newValue === 'dark' ? 'dark' : 'light'
      document.documentElement.setAttribute('data-theme', next)
      setTema(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Cerrar al pulsar fuera o con Escape.
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

  function toggleTema() {
    const next = tema === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('claux-theme', next)
    setTema(next)
  }

  function salir() {
    startTransition(async () => {
      await createClient().auth.signOut()
      router.push('/admin/login')
      router.refresh()
    })
  }

  // Se filtra con el MISMO `puedeAcceder` que la barra lateral y los guards de página.
  const visibles = paginasCuentaVisibles(key => puedeAcceder({ email, nombre: displayName, rol, permisos }, key))
  const grupos = GRUPOS_CUENTA
    .map(titulo => ({ titulo, items: visibles.filter(p => p.grupo === titulo) }))
    .filter(g => g.items.length > 0)

  return (
    <header className="admin-header">
      <div className="header-left">
        <MobileNavToggle shellSelector=".admin-shell" navId="admin-nav" />
        <Link href="/admin/dashboard" className="header-logo">
          <img src="/logo_color.svg" alt="CLAUX" className="logo-light" />
          <img src="/logo_blanco.svg" alt="CLAUX" className="logo-dark" />
        </Link>
      </div>
      <div className="header-right">
        {/* La Academia vive en la cabecera y no en una pantalla concreta porque no
            es una sección del panel: es el manual, y hay que poder abrirlo desde
            donde sea. Además es la única entrada del vendedor, que no tiene el
            dashboard donde antes estaba este enlace. */}
        <a
          href="/academia"
          target="_blank"
          rel="noopener"
          className="acad-entry acad-entry-header enlace-sobre-banda"
          aria-label="Academia"
        >
          <GraduationCap size={18} />
          <span className="acad-entry-label">Academia</span>
        </a>
        <AvisosCampana />
        <button
          type="button"
          className="theme-toggle-btn"
          onClick={toggleTema}
          aria-label={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          title={tema === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        >
          {tema === 'dark' ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
        </button>

        <div className="header-account" ref={ref}>
          {/* Solo las iniciales, igual que en el portal: el nombre y el rol
              ocupaban media cabecera para decir algo que ya se lee al abrir el
              menú, donde siguen estando. */}
          <button
            type="button"
            className="header-avatar-btn"
            onClick={() => setOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Menú de cuenta"
            title={displayName}
          >
            {getInitials(displayName)}
          </button>

          {open && (
            <div className="account-menu" role="menu">
              <div className="account-menu-header">
                <span className="account-menu-empresa">{displayName}</span>
                <span className="account-menu-email">{email}</span>
                <span className="account-menu-rol">{ROL_LABEL[rol]}</span>
              </div>
              <div className="account-menu-list">
                {grupos.map((g, gi) => (
                  <div key={g.titulo} className="account-menu-group">
                    {gi > 0 && <div className="account-menu-sep" />}
                    <span className="account-menu-group-label">{g.titulo}</span>
                    {g.items.map(o => {
                      const activo = pathname === o.ruta || pathname.startsWith(o.ruta + '/')
                      return (
                        <Link
                          key={o.ruta}
                          href={o.ruta}
                          role="menuitem"
                          onClick={() => setOpen(false)}
                          className={`account-menu-item${activo ? ' active' : ''}`}
                        >
                          {ICONOS[o.ruta]}
                          <span>{o.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                ))}
                <div className="account-menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="account-menu-item account-menu-logout"
                  onClick={() => { setOpen(false); setConfirmarSalida(true) }}
                >
                  <LogOut size={16} strokeWidth={2} />
                  <span>Cerrar sesión</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmarSalida && (
        <ConfirmDialog
          title="Cerrar sesión"
          body="¿Estás seguro de que deseas cerrar sesión?"
          confirmLabel="Cerrar sesión"
          pendingLabel="Cerrando sesión…"
          pending={cerrando}
          danger
          onConfirm={salir}
          onCancel={() => setConfirmarSalida(false)}
        />
      )}
    </header>
  )
}
