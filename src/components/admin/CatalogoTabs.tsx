'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Las dos caras de la misma decisión comercial: qué se vende (módulos y su
 * precio en cada columna) y cuánto cabe en cada nivel. Comparten permiso
 * (`modulos`), así que quien ve una ve la otra y no hace falta filtrar.
 *
 * Patrón de VentasTabs: pestañas por RUTA, no por estado.
 */
const TABS = [
  { href: '/admin/modulos', label: 'Módulos' },
  { href: '/admin/niveles', label: 'Niveles y límites' },
]

export default function CatalogoTabs() {
  const pathname = usePathname()
  return (
    <nav className="tabs" aria-label="Catálogo comercial">
      {TABS.map(t => (
        <Link
          key={t.href}
          href={t.href}
          prefetch
          className={`tab${pathname === t.href || pathname.startsWith(t.href + '/') ? ' active' : ''}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
