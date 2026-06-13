'use client'

import Link from 'next/link'

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
}

export default function Header({ displayName }: { email: string; displayName: string }) {
  return (
    <header className="admin-header">
      <a href="/admin/dashboard" className="header-logo">
        <div className="header-logo-icon"><span>C</span></div>
        <span className="header-logo-name">CLAUX</span>
      </a>
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
