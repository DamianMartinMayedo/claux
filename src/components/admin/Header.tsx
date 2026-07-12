'use client'

import Link from 'next/link'
import MobileNavToggle from '@/components/MobileNavToggle'
import type { RolAdmin } from '@/lib/roles'

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

const ROL_LABEL: Record<RolAdmin, string> = {
  super_admin: 'Super Admin',
  vendedor:    'Vendedor',
}

export default function Header({ displayName, rol }: { displayName: string; rol: RolAdmin }) {
  return (
    <header className="admin-header">
      <div className="header-left">
        <MobileNavToggle shellSelector=".admin-shell" navId="admin-nav" />
        <Link href="/admin/dashboard" className="header-logo">
          <img src="/logo_color.svg" alt="CLAUX" className="logo-light" />
          <img src="/logo_blanco.svg" alt="CLAUX" className="logo-dark" />
        </Link>
      </div>
      <div className="header-right">
        <Link href="/admin/configuracion" className="header-user-card">
          <div className="header-user-avatar">{getInitials(displayName)}</div>
          <div className="header-user-info">
            <span className="header-user-name">{displayName}</span>
            <span className="header-user-role">{ROL_LABEL[rol]}</span>
          </div>
        </Link>
      </div>
    </header>
  )
}
