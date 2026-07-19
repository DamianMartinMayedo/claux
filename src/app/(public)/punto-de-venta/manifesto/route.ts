import { NextResponse } from 'next/server'
import { nombrePunto } from '../nombre-punto'

// Manifest del punto de venta. El enlace de instalación trae `?c=<caja_id>`, así que
// el manifest se personaliza: la app instalada se llama como el punto de venta y nada
// más — «Mostrador», no «Punto de venta — CLAUX». Es lo que el dueño ve bajo el icono
// cada día, y con varios puntos en el mismo negocio es lo único que los distingue.
//
// El token NO viaja aquí: va en el fragmento del enlace, que el navegador no manda al
// servidor. Tras instalar, la app arranca en start_url y lo lee de IndexedDB.
export async function GET(req: Request) {
  const cajaId = new URL(req.url).searchParams.get('c') ?? undefined
  const nombre = await nombrePunto(cajaId)

  // Sin `c` (o con uno que no existe) queda el genérico: es lo que ve quien abre
  // /punto-de-venta a pelo, sin pasar por un enlace de instalación.
  const titulo = nombre ?? 'Punto de venta'

  return NextResponse.json({
    name: titulo,
    short_name: titulo,
    // start_url conserva el `?c=`: el navegador re-pide el manifest cada cierto tiempo
    // partiendo de start_url, y sin el parámetro la app instalada se renombraría sola
    // al genérico. `scope` se queda en la carpeta, que es la identidad de la PWA —
    // moverlo deja fuera de scope a los dispositivos ya instalados y los rompe.
    start_url: cajaId ? `/punto-de-venta?c=${encodeURIComponent(cajaId)}` : '/punto-de-venta',
    scope: '/punto-de-venta',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#eef1f5',
    theme_color: '#0d9488',
    icons: [
      { src: '/caja-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/caja-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  })
}
