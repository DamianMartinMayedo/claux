'use client'

import Link from 'next/link'
import MobileNavToggle from '@/components/MobileNavToggle'

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

export default function Header({ displayName }: { email: string; displayName: string }) {
  return (
    <header className="admin-header">
      <div className="header-left">
        <MobileNavToggle shellSelector=".admin-shell" navId="admin-nav" />
        <Link href="/admin/dashboard" className="header-logo">
          <img src="/logo_color.svg" alt="CLAUX" height={36} />
        </Link>
      </div>
      <div className="header-right">
        <Link href="/admin/configuracion" className="header-user-card">
          <div className="header-user-avatar">{getInitials(displayName)}</div>
          <div className="header-user-info">
            <span className="header-user-name">{displayName}</span>
            <span className="header-user-role">Super Admin</span>
          </div>
        </Link>
      </div>
    </header>
  )
}
