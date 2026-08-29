'use client'

import Link from 'next/link'
import { GraduationCap } from 'lucide-react'
import MobileNavToggle from '@/components/MobileNavToggle'
import AvisosCampana from '@/components/admin/notificaciones/AvisosCampana'
import { ROL_LABEL, type RolAdmin } from '@/lib/roles'

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'
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
        {/* La Academia vive en la cabecera y no en una pantalla concreta porque no
            es una sección del panel: es el manual, y hay que poder abrirlo desde
            donde sea. Además es la única entrada del vendedor, que no tiene el
            dashboard donde antes estaba este enlace. */}
        <a
          href="/academia"
          target="_blank"
          rel="noopener"
          className="acad-entry acad-entry-header enlace-sobre-banda"
          aria-label="Academia"
        >
          <GraduationCap size={18} />
          <span className="acad-entry-label">Academia</span>
        </a>
        <AvisosCampana />
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
