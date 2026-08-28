'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useTransition, useEffect, useRef } from 'react'
import { logoutCliente } from '@/app/actions/portal/auth'
import { ConfirmDialog } from '@/components/portal/Dialog'
import {
  construirNavegacion, rutasDe,
  type ModuloNav, type PaginaNav,
} from '@/lib/portal/navegacion'
import {
  LayoutDashboard, ShoppingCart, TrendingDown, ArrowUpRight, ArrowDownLeft,
  Wallet, FileText, Users, DollarSign, Package, Warehouse, ShoppingBag,
  Boxes, UserCircle, Building2, User, UsersRound, CreditCard, HelpCircle,
  QrCode, Calendar, Printer, Sparkles, Handshake, Repeat, Circle, ChevronDown, LogOut,
  CalendarClock, Banknote, BarChart3, CalendarDays, UtensilsCrossed,
  Store, ReceiptText, Lock, RefreshCw, Presentation, Contact,
} from 'lucide-react'

// El catálogo comercial tal cual llega de `modulos_catalogo` (lo carga el layout).
export type CatalogoItem = ModuloNav

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

interface Props {
  modulosVisibles: string[]                    // módulos que ESTE usuario puede ver (tenant ∩ permisos)
  catalogo:       CatalogoItem[]
  catalogoEtiqueta?: string                    // etiqueta del catálogo según sector ("Menú"…)
  /** «Suscripciones» | «Membresías» | «Bonos»… (mig. 164). Nunca «Contratos». */
  suscripcionEtiqueta?: string
  catalogoIcono?:    'comida' | 'producto'     // icono del navbar: cubiertos vs QR
}

export default function PortalSidebar({ modulosVisibles, catalogo, catalogoEtiqueta, suscripcionEtiqueta, catalogoIcono }: Props) {
  const pathname     = usePathname()
  const [pending, startTransition] = useTransition()
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)

  // Qué se pinta y en qué grupo: `lib/portal/navegacion`. Aquí solo quedan los
  // iconos, el colapso y la ruta activa; las reglas de contenido son compartidas
  // con el mapa del portal que lee la IA.
  const nav = construirNavegacion({
    catalogo,
    modulosVisibles,
    etiquetas: { catalogo: catalogoEtiqueta ?? '', suscripcion: suscripcionEtiqueta ?? '' },
  })

  // ── Colapso de grupos ──
  // Estado inicial DETERMINISTA: idéntico en el servidor y en el primer render del
  // cliente (base expandido, resto colapsado) → evita el hydration mismatch. Las
  // preferencias persistidas en localStorage se aplican tras montar (useEffect).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ base: false })
  const [hasHydrated, setHasHydrated] = useState(false)
  const contentRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Tras hidratar: leer preferencias guardadas y habilitar la animación de colapso.
  // Sincronizar con datos solo-cliente (localStorage) tras montar es intencional.
  useEffect(() => {
    const stored = readCollapsed()
    if (!('base' in stored)) stored['base'] = false // Contabilidad expandida por defecto
    setCollapsed(stored)
    setHasHydrated(true)
  }, [])

  function toggleGroup(key: string) {
    setCollapsed(prev => { const next = { ...prev, [key]: !prev[key] }; saveCollapsed(next); return next })
  }

  // Auto-expandir el grupo que contiene la ruta activa (sync navegación → UI; intencional).
  useEffect(() => {
    for (const m of nav.grupos) {
      const activeInGroup = m.paginas.some(p => pathname === p.ruta || pathname.startsWith(p.ruta + '/'))
      if (activeInGroup && collapsed[m.clave]) {
        setCollapsed(prev => { const next = { ...prev, [m.clave]: false }; saveCollapsed(next); return next })
      }
    }
    // Intencional: solo reacciona a la navegación. Incluir collapsed/catalogo
    // dispararía el efecto en cada toggle y rompería el colapso manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  function handleLogout() { setShowLogoutDialog(true) }
  function confirmLogout() { startTransition(() => { logoutCliente() }) }

  // Ruta activa = la coincidencia de prefijo MÁS específica (la más larga). Sin esto,
  // un hub como /portal/caja se quedaría "enganchado" como activo al navegar a una
  // subpágina hermana (/portal/caja/operaciones), que también empieza por /portal/caja.
  // Con el match más largo cada subpágina gana a su hub; el drill-down /portal/caja/<id>
  // (sin item propio) sigue activando el hub. El resto de módulos no anida rutas, así que
  // su comportamiento no cambia. Solo consideramos rutas de items realmente pintados.
  const navRutas = rutasDe(nav)
  const activeRuta = navRutas
    .filter(r => pathname === r || pathname.startsWith(r + '/'))
    .reduce<string | null>((best, r) => (best === null || r.length > best.length ? r : best), null)

  // Helper para renderizar una página (como Link en el sidebar). Solo se pintan
  // las páginas de módulos contratados, así que no hay estado "bloqueado".
  function renderPage(ruta: string, label: string, icon: React.ReactNode) {
    // El NOMBRE ya lo resolvió `construirNavegacion` (por sector). Aquí solo el icono:
    // restaurante → cubiertos, resto → QR.
    if (ruta === '/portal/catalogo' && catalogoEtiqueta) {
      icon = catalogoIcono === 'comida'
        ? <UtensilsCrossed size={18} strokeWidth={2} />
        : <QrCode size={18} strokeWidth={2} />
    }
    const active = ruta === activeRuta
    return (
      <Link key={ruta} href={ruta} className={`nav-item${active ? ' active' : ''}`}>
        {icon}
        <span className="flex-1">{label}</span>
      </Link>
    )
  }

  function renderCollapsibleGroup(clave: string, nombre: string, pages: PaginaNav[]) {
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
          {pages.map(p => renderPage(p.ruta, p.label, iconFor(p.ruta)))}
        </div>
      </div>
    )
  }

  return (
    <>
    <aside className="portal-sidebar" id="portal-nav">
      <nav className="flex-1">

        {/* Dashboard y funcionalidades contratadas: sueltas, sin grupo. */}
        {nav.sueltas.map(p => renderPage(p.ruta, p.label, iconFor(p.ruta)))}

        {/* Módulos (incluida Contabilidad) — grupos colapsables; solo los contratados,
            sin candados. Qué página cae en qué grupo lo decide `construirNavegacion`. */}
        {nav.grupos.map(g => renderCollapsibleGroup(g.clave, g.nombre, g.paginas))}

      </nav>

      <div className="sidebar-footer-nav">
        <button onClick={handleLogout} disabled={pending} className="nav-item nav-item-danger">
          <LogOut size={18} strokeWidth={2} />
          <span className="flex-1">Cerrar sesión</span>
        </button>
      </div>
    </aside>

    {showLogoutDialog && (
      <ConfirmDialog title="Cerrar sesión" body="¿Estás seguro de que deseas cerrar sesión?" confirmLabel="Cerrar sesión" pendingLabel="Cerrando sesión…" pending={pending} danger onConfirm={confirmLogout} onCancel={() => setShowLogoutDialog(false)} />
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
  '/portal/asesores':    <Contact size={18} strokeWidth={2} />,
  '/portal/terceros':    <Users size={18} strokeWidth={2} />,
  '/portal/monedas':     <DollarSign size={18} strokeWidth={2} />,
  '/portal/productos':   <Package size={18} strokeWidth={2} />,
  '/portal/almacenes':   <Warehouse size={18} strokeWidth={2} />,
  '/portal/compras':     <ShoppingBag size={18} strokeWidth={2} />,
  '/portal/inventario':  <Boxes size={18} strokeWidth={2} />,
  '/portal/servicios':   <Handshake size={18} strokeWidth={2} />,
  '/portal/suscripciones': <Repeat size={18} strokeWidth={2} />,
  '/portal/rrhh':          <UserCircle size={18} strokeWidth={2} />,
  '/portal/turnos':        <CalendarClock size={18} strokeWidth={2} />,
  '/portal/nomina':        <Banknote size={18} strokeWidth={2} />,
  '/portal/rrhh-reportes': <BarChart3 size={18} strokeWidth={2} />,
  '/portal/ia':          <Sparkles size={18} strokeWidth={2} />,
  '/portal/catalogo':    <QrCode size={18} strokeWidth={2} />,
  '/portal/reservas':    <Calendar size={18} strokeWidth={2} />,
  '/portal/citas':       <CalendarDays size={18} strokeWidth={2} />,
  '/portal/imprenta':    <Printer size={18} strokeWidth={2} />,
  '/portal/dossier':     <Presentation size={18} strokeWidth={2} />,
  '/portal/caja':               <Store size={18} strokeWidth={2} />,
  '/portal/caja/productos':     <Package size={18} strokeWidth={2} />,
  '/portal/caja/operaciones':   <ReceiptText size={18} strokeWidth={2} />,
  '/portal/caja/cierres':       <Lock size={18} strokeWidth={2} />,
  '/portal/caja/sincronizar':   <RefreshCw size={18} strokeWidth={2} />,
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
