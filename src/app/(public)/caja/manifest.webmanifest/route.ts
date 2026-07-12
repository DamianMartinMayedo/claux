import { NextResponse } from 'next/server'

// Manifest genérico de la caja (el token va en el fragmento del enlace de
// instalación, no en el manifest). Tras instalar, la app arranca en /caja y lee
// el token guardado en IndexedDB. Reutiliza los iconos PWA existentes.
export function GET() {
  return NextResponse.json({
    name: 'Caja — CLAUX',
    short_name: 'Caja',
    start_url: '/caja',
    scope: '/caja',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#eef1f5',
    theme_color: '#0d9488',
    icons: [
      { src: '/icon-catalogo-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-catalogo-512.png', sizes: '512x512', type: 'image/png' },
    ],
  })
}
