import type { Metadata } from 'next'

// NOTA: globals.css (el design system del portal) ya NO se importa aquí. Se carga
// en el layout de cada superficie interna (admin/, portal/, landing/, diagnostico/)
// para que las rutas públicas por-negocio de (public)/ — menú, reservar, citas —
// queden libres de su peso. Regla de públicas: CONTEXTO §3 / skills/ui/SKILL.md §6.

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
      'SaaS todo en uno para digitalizar tu negocio. Contabilidad, menú digital, reservas, inventario, RRHH y más.',
    type: 'website',
    locale: 'es_ES',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('claux-theme')||(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`,
          }}
        />
        {/* Las fuentes de marca las cargan las superficies internas vía <BrandFonts>
            (admin/portal/landing/diagnóstico). Las rutas públicas usan system-ui. */}
      </head>
      <body>{children}</body>
    </html>
  )
}
