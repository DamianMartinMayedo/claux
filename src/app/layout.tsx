import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  // Base para canonical y OG (relativos). Configurable por entorno; el equipo
  // puede fijar NEXT_PUBLIC_SITE_URL al dominio de producción.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://claux.app'),
  title: {
    default: 'CLAUX — Digitaliza tu negocio',
    template: '%s | CLAUX',
  },
  description:
    'SaaS todo en uno para digitalizar tu negocio. Contabilidad, menú digital QR, reservas, inventario y RRHH. Activas solo los módulos que necesitas.',
  keywords: ['CLAUX', 'ERP', 'SaaS', 'restaurantes', 'menú QR', 'reservas', 'contabilidad', 'digitalización', 'PYMES'],
  authors: [{ name: 'CLAUX' }],
  openGraph: {
    title: 'CLAUX — Digitaliza tu negocio',
    description:
      'SaaS todo en uno para digitalizar tu negocio. Contabilidad, menú digital QR, reservas, inventario y RRHH.',
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
