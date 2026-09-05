'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Sub-pestañas: el SEGUNDO nivel de navegación dentro de una pestaña.
 *
 * Es el componente canónico para eso, igual que `<Tabs>` lo es del primero. La
 * diferencia no es cosmética: `<Tabs>` es controlado (el padre guarda cuál está
 * activa) y esto navega —cada sub-pestaña es una RUTA—, así que la activa la
 * decide la URL y no hay estado que sincronizar.
 *
 * Y se ve distinto a propósito. Con el mismo estilo que `.tabs` —subrayado,
 * mismo tamaño, misma sangría— las dos filas parecían el mismo nivel y no se
 * notaba que hubiera un segundo. Aquí es un pastillero dentro de una bandeja,
 * sangrado y con una guía vertical: cuelga de la pestaña de arriba, no compite
 * con ella.
 *
 * Con una sola sub-pestaña visible no se pinta nada: un menú de un elemento no
 * es un menú. Pasa de verdad —los permisos filtran la lista—.
 *
 * CSS: `.subtabs` / `.subtab` en 03-components.css.
 */
export type SubTabItem = {
  href: string
  label: string
  /** Conteo opcional, mismo pill que en `<Tabs>`. */
  count?: number
  countTone?: 'neutral' | 'warning'
}

export default function SubTabs({ tabs, ariaLabel, activo }: {
  tabs: SubTabItem[]
  /** Qué agrupa este segundo nivel. Se lee con lector de pantalla. */
  ariaLabel: string
  /** Fuerza la activa. Por defecto la decide la URL. */
  activo?: string
}) {
  const pathname = usePathname()

  // Prefijo más largo, no igualdad: en el detalle de una propuesta
  // (`…/propuestas/12`) la activa sigue siendo «Propuestas». Con `===` no se
  // marcaba ninguna y el segundo nivel parecía apagado.
  const activa = activo ?? tabs
    .filter(t => pathname === t.href || pathname.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  if (tabs.length < 2) return null

  return (
    <nav className="subtabs" aria-label={ariaLabel}>
      {tabs.map(t => (
        <Link
          key={t.href}
          href={t.href}
          prefetch
          aria-current={t.href === activa ? 'page' : undefined}
          className={`subtab${t.href === activa ? ' active' : ''}`}
        >
          {t.label}
          {typeof t.count === 'number' && (
            <span className={`tab-count${t.countTone === 'warning' ? ' tab-count-warning' : ''}`}>{t.count}</span>
          )}
        </Link>
      ))}
    </nav>
  )
}
