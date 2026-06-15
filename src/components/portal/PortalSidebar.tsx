'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useTransition, useEffect, useRef } from 'react'
import { logoutCliente } from '@/app/actions/portal/auth'
import { ConfirmDialog } from '@/components/portal/Dialog'

type Rol = 'admin_empresa' | 'usuario'

interface PaginaInfo {
  ruta: string
  label: string
  orden: number
}

interface CatalogoItem {
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
    { ruta: '/portal/perfil',      label: 'Mi perfil',   icon: <IconPerfil /> },
    ...(rol === 'admin_empresa' ? [{ ruta: '/portal/usuarios', label: 'Usuarios', icon: <IconUsuarios /> }] : []),
    { ruta: '/portal/empresas',    label: 'Mis Empresas',    icon: <IconEmpresas /> },
    { ruta: '/portal/facturacion', label: 'Suscripción', icon: <IconFacturacion /> },
    { ruta: '/portal/soporte',     label: 'Soporte',     icon: <IconSoporte /> },
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

  useEffect(() => { setHasHydrated(true) }, [])

  function toggleGroup(key: string) {
    setCollapsed(prev => { const next = { ...prev, [key]: !prev[key] }; saveCollapsed(next); return next })
  }

  // Auto-expand if current path is inside a collapsed group
  useEffect(() => {
    for (const m of catalogItems) {
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
        {bloqueado && <IconLock />}
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
          <svg className={`nav-chevron${!isCollapsed ? ' nav-chevron-open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
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
          <IconDashboard />
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
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
const ICON_MAP: Record<string, React.ReactNode> = {
  '/portal/ventas':     <IconVentas />,
  '/portal/gastos':     <IconGastos />,
  '/portal/cxc':        <IconCxC />,
  '/portal/cxp':        <IconCxP />,
  '/portal/tesoreria':  <IconTesoreria />,
  '/portal/reportes':   <IconReportes />,
  '/portal/terceros':   <IconTerceros />,
  '/portal/monedas':    <IconMonedas />,
  '/portal/productos':  <IconProductos />,
  '/portal/almacenes':  <IconAlmacenes />,
  '/portal/compras':    <IconCompras />,
  '/portal/inventario': <IconInventario />,
  '/portal/rrhh':       <IconRRHH />,
  '/portal/ia':         <IconIA />,
  '/portal/catalogo':   <IconCatalogo />,
  '/portal/reservas':   <IconReservas />,
  '/portal/imprenta':   <IconImprenta />,
  '/portal/empresas':   <IconEmpresas />,
  '/portal/perfil':     <IconPerfil />,
  '/portal/usuarios':   <IconUsuarios />,
  '/portal/facturacion': <IconFacturacion />,
  '/portal/soporte':    <IconSoporte />,
  '/portal/dashboard':  <IconDashboard />,
}

function iconFor(ruta: string): React.ReactNode {
  return ICON_MAP[ruta] ?? <IconDefault />
}

// ── Iconos ────────────────────────────────────────────────────────────────────
function IconDefault() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> }
function IconDashboard() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> }
function IconVentas() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg> }
function IconGastos() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M16 14l-4-4-4 4"/><line x1="12" y1="10" x2="12" y2="17"/></svg> }
function IconCxC() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg> }
function IconCxP() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1v22M6 19h10.5a3.5 3.5 0 000-7H11.5a3.5 3.5 0 010-7H18"/></svg> }
function IconTesoreria() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> }
function IconReportes() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg> }
function IconTerceros() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> }
function IconInventario() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg> }
function IconRRHH() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> }
function IconProductos() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> }
function IconAlmacenes() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> }
function IconCompras() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.98 1.61h9.72a2 2 0 001.98-1.61L23 6H6"/></svg> }
function IconMonedas() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> }
function IconEmpresas() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg> }
function IconPerfil() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> }
function IconUsuarios() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> }
function IconFacturacion() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg> }
function IconSoporte() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> }
function IconCatalogo() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> }
function IconReservas() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> }
function IconImprenta() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 12H4a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4z"/><rect x="8" y="14" width="8" height="8" rx="1"/></svg> }
function IconIA() { return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a1 1 0 011 1v2a1 1 0 01-2 0V3a1 1 0 011-1zm0 16a1 1 0 011 1v2a1 1 0 01-2 0v-2a1 1 0 011-1zm8.66-13.66a1 1 0 01-1.41 0l-1.41-1.41a1 1 0 111.41-1.41l1.41 1.41a1 1 0 010 1.41zM5.64 19.36a1 1 0 01-1.41 0l-1.41-1.41a1 1 0 011.41-1.41l1.41 1.41a1 1 0 010 1.41zM22 12a1 1 0 01-1 1h-2a1 1 0 010-2h2a1 1 0 011 1zM4 12a1 1 0 01-1 1H1a1 1 0 010-2h2a1 1 0 011 1zm14.34 7.36a1 1 0 010 1.41l-1.41 1.41a1 1 0 01-1.41-1.41l1.41-1.41a1 1 0 011.41 0zM8.34 7.07a1 1 0 01-1.41 0L5.52 5.66a1 1 0 011.41-1.41l1.41 1.41a1 1 0 010 1.41z"/><circle cx="12" cy="12" r="4"/></svg> }
function IconLock() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.5 }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> }
