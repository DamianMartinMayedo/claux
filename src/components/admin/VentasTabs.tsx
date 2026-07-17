'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { RolAdmin, SeccionKey } from '@/lib/roles'

const TABS: { href: string; label: string; key: SeccionKey; match: string[] }[] = [
  { href: '/admin/solicitudes',     label: 'Solicitudes',  key: 'solicitudes',  match: ['/admin/solicitudes'] },
  { href: '/admin/presupuestos',    label: 'Presupuestos', key: 'presupuestos', match: ['/admin/presupuestos'] },
  { href: '/admin/ventas/clientes', label: 'Clientes',     key: 'clientes_ro',  match: ['/admin/ventas/clientes'] },
]

export default function VentasTabs({ rol, permisos }: { rol: RolAdmin; permisos: SeccionKey[] }) {
  const pathname = usePathname()
  const visibles = TABS.filter(t => rol === 'super_admin' || permisos.includes(t.key))
  if (visibles.length <= 1) return null

  return (
    <nav className="tabs" aria-label="Secciones de ventas">
      {visibles.map(t => {
        const activo = t.match.some(p => pathname === p || pathname.startsWith(p + '/'))
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch
            className={`tab${activo ? ' active' : ''}`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
