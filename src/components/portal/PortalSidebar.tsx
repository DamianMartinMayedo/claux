'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useTransition } from 'react'
import { logoutCliente } from '@/app/actions/portal/auth'
import { ConfirmDialog } from '@/components/portal/Dialog'

type Rol = 'admin_empresa' | 'usuario'

interface NavItem {
  href:    string
  label:   string
  modulo?: string   // null/undefined = siempre visible; string = requiere módulo activo
  icon:    React.ReactNode
}

interface NavGroup {
  label: string
  items: NavItem[]
}

function buildNav(rol: Rol): NavGroup[] {
  return [
    {
      label: 'Principal',
      items: [
        { href: '/portal/dashboard', label: 'Dashboard', icon: <IconDashboard /> },
      ],
    },
    {
      // Base contable — siempre visible (sin modulo: los items sin gate nunca se bloquean)
      label: 'Contabilidad',
      items: [
        { href: '/portal/ventas',     label: 'Ventas',              icon: <IconVentas /> },
        { href: '/portal/gastos',     label: 'Gastos y cobros',     icon: <IconGastos /> },
        { href: '/portal/cxc',        label: 'Cuentas por cobrar',  icon: <IconCxC /> },
        { href: '/portal/cxp',        label: 'Cuentas por pagar',   icon: <IconCxP /> },
        { href: '/portal/tesoreria',  label: 'Tesorería',           icon: <IconTesoreria /> },
        { href: '/portal/reportes',   label: 'Reportes',            icon: <IconReportes /> },
        { href: '/portal/terceros',   label: 'Terceros',            icon: <IconTerceros /> },
        { href: '/portal/monedas',    label: 'Monedas y Tasas',     icon: <IconMonedas /> },
      ],
    },
    {
      label: 'Inventario',
      items: [
        { href: '/portal/productos',  label: 'Productos',   modulo: 'inventario', icon: <IconProductos /> },
        { href: '/portal/almacenes',  label: 'Almacenes',   modulo: 'inventario', icon: <IconAlmacenes /> },
        { href: '/portal/compras',    label: 'Compras',     modulo: 'inventario', icon: <IconCompras /> },
        { href: '/portal/inventario', label: 'Movimientos', modulo: 'inventario', icon: <IconInventario /> },
      ],
    },
    {
      label: 'RRHH',
      items: [
        { href: '/portal/rrhh', label: 'Personal y nómina', modulo: 'rrhh', icon: <IconRRHH /> },
      ],
    },
    {
      label: 'Multiempresa',
      items: [
        { href: '/portal/empresas', label: 'Mis Empresas', modulo: 'multiempresa', icon: <IconEmpresas /> },
      ],
    },
    {
      label: 'Asistente IA',
      items: [
        { href: '/portal/ia', label: 'Asistente IA', modulo: 'asistente_ia', icon: <IconIA /> },
      ],
    },
    {
      label: 'Funcionalidades',
      items: [
        { href: '/portal/catalogo',  label: 'Catálogo QR',        modulo: 'catalogo_qr',         icon: <IconCatalogo /> },
        { href: '/portal/reservas',  label: 'Reservas y citas',   modulo: 'reservas_citas',      icon: <IconReservas /> },
        { href: '/portal/imprenta',  label: 'Docs imprenta',      modulo: 'documentos_imprenta', icon: <IconImprenta /> },
      ],
    },
    {
      label: 'Cuenta',
      items: [
        { href: '/portal/perfil',      label: 'Mi perfil',   icon: <IconPerfil /> },
        ...(rol === 'admin_empresa'
          ? [{ href: '/portal/usuarios', label: 'Usuarios', icon: <IconUsuarios /> }]
          : []),
        { href: '/portal/facturacion', label: 'Facturación', icon: <IconFacturacion /> },
        { href: '/portal/soporte',     label: 'Soporte',     icon: <IconSoporte /> },
      ],
    },
  ]
}

interface Props {
  rol:            Rol
  modulosActivos: string[]
}

export default function PortalSidebar({ rol, modulosActivos }: Props) {
  const pathname     = usePathname()
  const [pending, startTransition] = useTransition()
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)

  function handleLogout() {
    setShowLogoutDialog(true)
  }

  function confirmLogout() {
    startTransition(() => { logoutCliente() })
  }

  const nav = buildNav(rol)

  return (
    <>
    <aside className="portal-sidebar">
      <nav className="flex-1">
        {nav.map(group => (
          <div key={group.label}>
            <p className="nav-section-label">{group.label}</p>
            {group.items.map(item => {
              const bloqueado = !!item.modulo && !modulosActivos.includes(item.modulo)
              const active    = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link
                  key={item.href}
                  href={bloqueado ? '#' : item.href}
                  className={`nav-item${active ? ' active' : ''}${bloqueado ? ' nav-item-locked' : ''}`}
                  title={bloqueado ? 'Módulo no incluido en tu plan' : undefined}
                  aria-disabled={bloqueado}
                >
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                  {bloqueado && <IconLock />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer-nav">
        <button
          onClick={handleLogout}
          disabled={pending}
          className="nav-item nav-item-danger"
        >
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
      <ConfirmDialog
        title="Cerrar sesión"
        body="¿Estás seguro de que deseas cerrar sesión?"
        confirmLabel="Cerrar sesión"
        danger
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutDialog(false)}
      />
    )}
  </>
  )
}

// ── Iconos ────────────────────────────────────────────────────────────────────

function IconDashboard() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
}
function IconVentas() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
}
function IconCompras() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.98 1.61h9.72a2 2 0 001.98-1.61L23 6H6"/></svg>
}
function IconTesoreria() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
}
function IconTerceros() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
}
function IconInventario() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
}
function IconGastos() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 8v4l3 3"/></svg>
}
function IconCxC() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><path d="M10 17l2-2 2 2"/></svg>
}
function IconCxP() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><path d="M10 15l2 2 2-2"/></svg>
}
function IconReportes() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
}
function IconIA() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a5 5 0 015 5v3a5 5 0 01-10 0V7a5 5 0 015-5z"/><path d="M2 17c0-3 3-5 10-5s10 2 10 5"/></svg>
}
function IconCatalogo() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
}
function IconReservas() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
}
function IconImprenta() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
}
function IconRRHH() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
}
function IconProductos() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
}
function IconAlmacenes() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
}
function IconMonedas() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
}
function IconEmpresas() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
}
function IconPerfil() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
}
function IconUsuarios() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
}
function IconFacturacion() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
}
function IconSoporte() {
  return <svg className="flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
}
function IconLock() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0" opacity="0.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
}
