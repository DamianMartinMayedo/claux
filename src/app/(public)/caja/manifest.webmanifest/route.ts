import { NextResponse } from 'next/server'

// Manifest de la caja (el token va en el fragmento del enlace de
// instalación, no en el manifest). Tras instalar, la app arranca en /caja y lee
// el token guardado en IndexedDB.
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
      { src: '/caja.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/caja.png', sizes: '512x512', type: 'image/png' },
    ],
  })
}
