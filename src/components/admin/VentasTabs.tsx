'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { RolAdmin, SeccionKey } from '@/lib/roles'

const TABS: { href: string; label: string; key: SeccionKey; match: string[] }[] = [
  { href: '/admin/solicitudes',     label: 'Solicitudes',  key: 'solicitudes',  match: ['/admin/solicitudes'] },
  // Misma llave que Solicitudes: son solicitudes también, solo que de clientes
  // que ya lo son. No se inventa un permiso nuevo para una lista más.
  { href: '/admin/ventas/ampliaciones', label: 'Ampliaciones', key: 'solicitudes', match: ['/admin/ventas/ampliaciones'] },
  { href: '/admin/presupuestos',    label: 'Presupuestos', key: 'presupuestos', match: ['/admin/presupuestos'] },
  { href: '/admin/ventas/propuestas', label: 'Propuestas', key: 'propuestas',   match: ['/admin/ventas/propuestas'] },
  { href: '/admin/ventas/clientes', label: 'Clientes',     key: 'clientes_ro',  match: ['/admin/ventas/clientes'] },
]

export default function VentasTabs({ rol, permisos }: { rol: RolAdmin; permisos: SeccionKey[] }) {
  const pathname = usePathname()
  const visibles = TABS.filter(t => rol === 'super_admin' || permisos.includes(t.key))
  if (visibles.length <= 1) return null

  // Gana la coincidencia MÁS LARGA. Propuestas es un entorno con páginas debajo
  // (capturas, textos) y todas encienden su pestaña; con `some`, una ruta que
  // cayera dentro de dos prefijos encendería las dos.
  const largo = (t: { match: string[] }) => Math.max(
    ...t.match.map(p => (pathname === p || pathname.startsWith(p + '/') ? p.length : -1)),
  )
  const mejor = Math.max(...visibles.map(largo))

  return (
    <nav className="tabs" aria-label="Secciones de ventas">
      {visibles.map(t => {
        const activo = mejor > 0 && largo(t) === mejor
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
