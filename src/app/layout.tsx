import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'CLAUX — Digitaliza tu negocio en Cuba',
    template: '%s | CLAUX',
  },
  description:
    'SaaS todo en uno para digitalizar negocios locales cubanos. Contabilidad, menú digital QR, reservas, inventario y RRHH. Sin complicaciones, desde cualquier móvil.',
  keywords: ['CLAUX', 'ERP', 'SaaS', 'Cuba', 'restaurantes', 'menú QR', 'reservas', 'contabilidad', 'PYMES'],
  authors: [{ name: 'CLAUX' }],
  openGraph: {
    title: 'CLAUX — Digitaliza tu negocio en Cuba',
    description:
      'SaaS todo en uno para digitalizar negocios locales cubanos. Contabilidad, menú digital QR, reservas, inventario y RRHH.',
    type: 'website',
    locale: 'es_ES',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
