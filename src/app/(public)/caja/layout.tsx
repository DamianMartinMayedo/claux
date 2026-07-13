import type { Metadata, Viewport } from 'next'
// App de caja offline: aislada del design system del portal (regla de públicas,
// SKILL §6). Solo su hoja propia namespaced (--ca-*) sobre el reset público.
import './caja-app.css'
import CajaPwaRegister from './CajaPwaRegister'

export const metadata: Metadata = {
  title: 'Caja — CLAUX',
  manifest: '/caja/manifesto',
  icons: { apple: '/caja-180.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Caja' },
}

export const viewport: Viewport = {
  themeColor: '#0d9488',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function CajaAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ca-app">
      <CajaPwaRegister />
      {children}
    </div>
  )
}
