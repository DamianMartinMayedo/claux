'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useTransition, useEffect, useRef } from 'react'
import { logoutCliente } from '@/app/actions/portal/auth'
import { ConfirmDialog } from '@/components/portal/Dialog'
import {
  LayoutDashboard, ShoppingCart, TrendingDown, ArrowUpRight, ArrowDownLeft,
  Wallet, FileText, Users, DollarSign, Package, Warehouse, ShoppingBag,
  Boxes, UserCircle, Building2, User, UsersRound, CreditCard, HelpCircle,
  QrCode, Calendar, Printer, Sparkles, Lock, Circle, ChevronDown, LogOut,
} from 'lucide-react'

type Rol = 'admin_empresa' | 'usuario'

interface PaginaInfo {
  ruta: string
  label: string
  orden: number
}

export interface CatalogoItem {
  clave: string
  nombre: string
  tipo: 'base' | 'modulo' | 'funcionalidad' | 'addon'
  paginas: PaginaInfo[] | null
  orden: number
}

function ensurePages(paginas: unknown): PaginaInfo[] {
  if (Array.isArray(paginas)) return paginas
  if (typeof paginas === 'string') {
    try { const p = JSON.parse(paginas); return Array.isArray(p) ? p : [] }
    catch { return [] }
  }
  return []
}

const STORAGE_KEY = 'claux_sidebar_collapsed'

function readCollapsed(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : {} }
  catch { return {} }
}
function saveCollapsed(state: Record<string, boolean>) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
}

// ── Configuración: páginas fijas del sistema ──
function buildConfiguracion(rol: Rol) {
  return [
    { ruta: '/portal/perfil',      label: 'Mi perfil',   icon: <User size={18} strokeWidth={2} /> },
    ...(rol === 'admin_empresa' ? [{ ruta: '/portal/usuarios', label: 'Usuarios', icon: <UsersRound size={18} strokeWidth={2} /> }] : []),
    { ruta: '/portal/empresas',    label: 'Mis Empresas',    icon: <Building2 size={18} strokeWidth={2} /> },
    { ruta: '/portal/facturacion', label: 'Suscripción', icon: <CreditCard size={18} strokeWidth={2} /> },
    { ruta: '/portal/soporte',     label: 'Soporte',     icon: <HelpCircle size={18} strokeWidth={2} /> },
  ]
}

interface Props {
  rol:            Rol
  modulosActivos: string[]
  catalogo:       CatalogoItem[]
}

export default function PortalSidebar({ rol, modulosActivos, catalogo }: Props) {
  const pathname     = usePathname()
  const [pending, startTransition] = useTransition()
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)

  // ── Colapso de grupos ──
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const stored = readCollapsed()
    if (!('base' in stored)) stored['base'] = false // Contabilidad siempre expandido
    return stored
  })
  const [hasHydrated, setHasHydrated] = useState(false)
  const contentRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Flag de hidratación (evita animar el colapso en el primer render). Patrón estándar.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setHasHydrated(true) }, [])

  function toggleGroup(key: string) {
    setCollapsed(prev => { const next = { ...prev, [key]: !prev[key] }; saveCollapsed(next); return next })
  }

  // Auto-expandir el grupo que contiene la ruta activa (sync navegación → UI; intencional).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    for (const m of catalogo) {
      const pages = (m.tipo === 'modulo' || m.tipo === 'base') ? (m.paginas ?? []) : []
      const activeInGroup = pages.some(p => pathname === p.ruta || pathname.startsWith(p.ruta + '/'))
      if (activeInGroup && collapsed[m.clave]) {
        setCollapsed(prev => { const next = { ...prev, [m.clave]: false }; saveCollapsed(next); return next })
      }
    }
    // Also check configuración group
    const cfgActive = buildConfiguracion(rol).some(p => pathname === p.ruta || pathname.startsWith(p.ruta + '/'))
    if (cfgActive && collapsed['configuracion']) {
      setCollapsed(prev => { const next = { ...prev, configuracion: false }; saveCollapsed(next); return next })
    }
  }, [pathname])
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleLogout() { setShowLogoutDialog(true) }
  function confirmLogout() { startTransition(() => { logoutCliente() }) }

  const isDashboardActive = pathname === '/portal/dashboard' || pathname.startsWith('/portal/dashboard/')

  // Separar catálogo por tipo
  const catalogItems = catalogo
  const baseGroup     = catalogItems.find(c => c.tipo === 'base')
  const modulos       = catalogItems.filter(c => c.tipo === 'modulo')
  const funcionalidades = catalogItems.filter(c => c.tipo === 'funcionalidad')
  // addons no generan items de navegación
  const cfgPages      = buildConfiguracion(rol)

  // Helper para renderizar una página (como Link en el sidebar)
  function renderPage(ruta: string, label: string, icon: React.ReactNode, bloqueado: boolean) {
    const active = pathname === ruta || pathname.startsWith(ruta + '/')
    return (
      <Link
        key={ruta}
        href={bloqueado ? '#' : ruta}
        className={`nav-item${active ? ' active' : ''}${bloqueado ? ' nav-item-locked' : ''}`}
        title={bloqueado ? 'Módulo no incluido en tu plan' : undefined}
        aria-disabled={bloqueado}
      >
        {icon}
        <span className="flex-1">{label}</span>
        {bloqueado && <Lock size={12} strokeWidth={2} style={{ flexShrink: 0, opacity: 0.5 }} />}
      </Link>
    )
  }

  function renderCollapsibleGroup(clave: string, nombre: string, pages: PaginaInfo[], active: boolean) {
    const isCollapsed = collapsed[clave] ?? true
    return (
      <div key={clave}>
        <button
          className="nav-section-label nav-section-collapse"
          onClick={() => toggleGroup(clave)}
          aria-expanded={!isCollapsed}
        >
          <span>{nombre}</span>
          <ChevronDown size={14} strokeWidth={2.5} className={`nav-chevron${!isCollapsed ? ' nav-chevron-open' : ''}`} aria-hidden="true" />
        </button>
        <div ref={el => { contentRefs.current[clave] = el }} className={`nav-collapse-wrapper${!isCollapsed ? ' nav-collapse-open' : ''}`} style={!hasHydrated ? { maxHeight: isCollapsed ? '0px' : 'none' } : undefined}>
          {pages.map(p => renderPage(p.ruta, p.label, iconFor(p.ruta), active ? false : !modulosActivos.includes(clave)))}
        </div>
      </div>
    )
  }

  // Agrupación: base → Contabilidad (always expanded by default), modulos → collapsible, funcionalidades → standalone
  const basePages    = ensurePages(baseGroup?.paginas).sort((a, b) => a.orden - b.orden)

  return (
    <>
    <aside className="portal-sidebar">
      <nav className="flex-1">

        {/* Dashboard — standalone */}
        <Link href="/portal/dashboard" className={`nav-item${isDashboardActive ? ' active' : ''}`}>
          <LayoutDashboard size={18} strokeWidth={2} />
          <span className="flex-1">Dashboard</span>
        </Link>

        {/* Funcionalidades — standalone, solo visibles si activas */}
        {funcionalidades
          .filter(f => modulosActivos.includes(f.clave))
          .map(f => {
            const pages = ensurePages(f.paginas).sort((a, b) => a.orden - b.orden)
            return pages.map(p => renderPage(p.ruta, p.label, iconFor(p.ruta), false))
          })}

        {/* Base (Contabilidad) — grupo colapsable, siempre visible, siempre activo */}
        {baseGroup && renderCollapsibleGroup('base', baseGroup.nombre, basePages, true)}

        {/* Módulos — grupos colapsables, páginas bloqueadas si no activo */}
        {modulos.map(m => {
          const pages = ensurePages(m.paginas).sort((a, b) => a.orden - b.orden)
          const isActive = modulosActivos.includes(m.clave)
          return renderCollapsibleGroup(m.clave, m.nombre, pages, isActive)
        })}

        {/* Configuración — grupo colapsable fijo, siempre visible */}
        {renderCollapsibleGroup('configuracion', 'Configuración',
          cfgPages.map((p, i) => ({ ruta: p.ruta, label: p.label, orden: i })),
          true
        )}
      </nav>

      <div className="sidebar-footer-nav">
        <button onClick={handleLogout} disabled={pending} className="nav-item nav-item-danger">
          <LogOut size={18} strokeWidth={2} />
          <span className="flex-1">Cerrar sesión</span>
        </button>
      </div>
    </aside>

    {showLogoutDialog && (
      <ConfirmDialog title="Cerrar sesión" body="¿Estás seguro de que deseas cerrar sesión?" confirmLabel="Cerrar sesión" danger onConfirm={confirmLogout} onCancel={() => setShowLogoutDialog(false)} />
    )}
  </>
  )
}

// ── Mapa de rutas → iconos ──
const ICON: Record<string, React.ReactNode> = {
  '/portal/ventas':      <ShoppingCart size={18} strokeWidth={2} />,
  '/portal/gastos':      <TrendingDown size={18} strokeWidth={2} />,
  '/portal/cxc':         <ArrowUpRight size={18} strokeWidth={2} />,
  '/portal/cxp':         <ArrowDownLeft size={18} strokeWidth={2} />,
  '/portal/tesoreria':   <Wallet size={18} strokeWidth={2} />,
  '/portal/reportes':    <FileText size={18} strokeWidth={2} />,
  '/portal/terceros':    <Users size={18} strokeWidth={2} />,
  '/portal/monedas':     <DollarSign size={18} strokeWidth={2} />,
  '/portal/productos':   <Package size={18} strokeWidth={2} />,
  '/portal/almacenes':   <Warehouse size={18} strokeWidth={2} />,
  '/portal/compras':     <ShoppingBag size={18} strokeWidth={2} />,
  '/portal/inventario':  <Boxes size={18} strokeWidth={2} />,
  '/portal/rrhh':        <UserCircle size={18} strokeWidth={2} />,
  '/portal/ia':          <Sparkles size={18} strokeWidth={2} />,
  '/portal/catalogo':    <QrCode size={18} strokeWidth={2} />,
  '/portal/reservas':    <Calendar size={18} strokeWidth={2} />,
  '/portal/imprenta':    <Printer size={18} strokeWidth={2} />,
  '/portal/empresas':    <Building2 size={18} strokeWidth={2} />,
  '/portal/perfil':      <User size={18} strokeWidth={2} />,
  '/portal/usuarios':    <UsersRound size={18} strokeWidth={2} />,
  '/portal/facturacion': <CreditCard size={18} strokeWidth={2} />,
  '/portal/soporte':     <HelpCircle size={18} strokeWidth={2} />,
  '/portal/dashboard':   <LayoutDashboard size={18} strokeWidth={2} />,
}

function iconFor(ruta: string): React.ReactNode {
  return ICON[ruta] ?? <Circle size={18} strokeWidth={2} />
}
