'use client'

import { BarChart3, Bell, Boxes, Clock, CreditCard, LayoutGrid, LifeBuoy, LogOut, Settings, Sparkles, Stethoscope, Store, UserCog, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { RUTA_SECCION, type RolAdmin, type SeccionKey } from '@/lib/roles'

type NavItem = {
  href:   string
  label:  string
  icon:   React.ReactNode
  key?:   SeccionKey       // sección única requerida
  anyOf?: SeccionKey[]     // visible si tiene CUALQUIERA de estas
  match?: string[]         // prefijos de ruta que marcan el item activo
}

type NavGroup = { section: string; items: NavItem[] }

const NAV: NavGroup[] = [
  {
    section: 'Principal',
    items: [
      { href: '/admin/dashboard', label: 'Dashboard', key: 'dashboard', icon: (
        <LayoutGrid size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/metricas', label: 'Métricas', key: 'metricas', icon: (
        <BarChart3 size={18} className="flex-shrink-0" />
      )},
    ]
  },
  {
    section: 'Gestión',
    items: [
      { href: '/admin/solicitudes', label: 'Ventas', anyOf: ['solicitudes', 'presupuestos', 'clientes_ro'],
        match: ['/admin/solicitudes', '/admin/presupuestos', '/admin/ventas'], icon: (
        <Store size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/clientes', label: 'Clientes', key: 'clientes', icon: (
        <Users size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/modulos', label: 'Módulos', key: 'modulos', icon: (
        <Boxes size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/ia', label: 'Asistente IA', key: 'ia', icon: (
        <Sparkles size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/diagnostico', label: 'Diagnóstico', key: 'diagnostico', icon: (
        <Stethoscope size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/pagos', label: 'Pagos', key: 'pagos', icon: (
        <CreditCard size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/soporte', label: 'Soporte', key: 'soporte', icon: (
        <LifeBuoy size={18} className="flex-shrink-0" />
      )},
    ]
  },
  {
    section: 'Sistema',
    items: [
      { href: '/admin/usuarios', label: 'Usuarios', key: 'usuarios', icon: (
        <UserCog size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/configuracion', label: 'Configuración', key: 'configuracion', icon: (
        <Settings size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/notificaciones', label: 'Notificaciones', key: 'notificaciones', icon: (
        <Bell size={18} className="flex-shrink-0" />
      )},
      { href: '/admin/actividad', label: 'Actividad', key: 'actividad', icon: (
        <Clock size={18} className="flex-shrink-0" />
      )},
    ]
  },
]

export default function Sidebar({ rol, permisos }: { rol: RolAdmin; permisos: SeccionKey[] }) {
  const pathname = usePathname()
  const router   = useRouter()

  const visible = (item: NavItem): boolean => {
    if (rol === 'super_admin') return true
    if (item.anyOf) return item.anyOf.some(k => permisos.includes(k))
    if (item.key)   return permisos.includes(item.key)
    return false
  }

  // El item "Ventas" enlaza a la primera sub-sección accesible del vendedor.
  const hrefDe = (item: NavItem): string => {
    if (rol === 'super_admin' || !item.anyOf) return item.href
    const k = item.anyOf.find(x => permisos.includes(x))
    return k ? RUTA_SECCION[k] : item.href
  }

  const esActivo = (item: NavItem): boolean => {
    const prefijos = item.match ?? [item.href]
    return prefijos.some(p => pathname === p || pathname.startsWith(p + '/'))
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/admin/login')
    router.refresh()
  }

  return (
    <aside className="admin-sidebar" id="admin-nav">
      <nav className="flex-1">
        {NAV.map(group => {
          const items = group.items.filter(visible)
          if (items.length === 0) return null
          return (
            <div key={group.section}>
              <p className="nav-section-label">{group.section}</p>
              {items.map(item => (
                <Link key={item.href} href={hrefDe(item)} className={`nav-item${esActivo(item) ? ' active' : ''}`}>
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                </Link>
              ))}
            </div>
          )
        })}
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
