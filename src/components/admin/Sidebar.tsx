'use client'

import { Bell, Boxes, Clock, CreditCard, LayoutGrid, LogOut, Settings, Sparkles, Stethoscope, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const NAV = [
  {
    section: 'Principal',
    items: [
      { href: '/admin/dashboard', label: 'Dashboard', icon: (
        <LayoutGrid size={18} className="flex-shrink-0" />
      )},
    ]
  },
  {
    section: 'Gestión',
    items: [
      { href: '/admin/clientes', label: 'Clientes', icon: (
        <Users size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/modulos', label: 'Módulos', icon: (
        <Boxes size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/ia', label: 'Asistente IA', icon: (
        <Sparkles size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/diagnostico', label: 'Diagnóstico', icon: (
        <Stethoscope size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/pagos', label: 'Pagos', icon: (
        <CreditCard size={18} className="flex-shrink-0" />
      )},
    ]
  },
  {
    section: 'Sistema',
    items: [
      { href: '/admin/configuracion', label: 'Configuración', icon: (
        <Settings size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/notificaciones', label: 'Notificaciones', icon: (
        <Bell size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/actividad', label: 'Actividad', icon: (
        <Clock size={18} className="flex-shrink-0" />
      )},
    ]
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/admin/login')
    router.refresh()
  }

  return (
    <aside className="admin-sidebar">
      <nav className="flex-1">
        {NAV.map(group => (
          <div key={group.section}>
            <p className="nav-section-label">{group.section}</p>
            {group.items.map(item => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link key={item.href} href={item.href} className={`nav-item${active ? ' active' : ''}`}>
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Logout al fondo */}
      <div className="sidebar-footer-nav">
        <button onClick={handleLogout} className="nav-item nav-item-danger">
          <LogOut size={18} className="flex-shrink-0" />
          <span className="flex-1">Cerrar sesión</span>
        </button>
      </div>
    </aside>
  )
}
