import type { Metadata } from 'next'

// Identidad de la PWA en las dos rutas que la sirven. El nombre es SOLO el del punto
// de venta, sin sufijo de marca: es lo que se ve en la pestaña, en el diálogo de
// instalar y bajo el icono, y con varios puntos en el mismo negocio es lo único que
// los distingue. `apple-mobile-web-app-title` es el equivalente de short_name en iOS,
// así que va con el mismo valor o el iPhone pondría otro.
export function metadataPunto(cajaId: string | undefined, nombre: string | null): Metadata {
  const titulo = nombre ?? 'Punto de venta'
  return {
    title: titulo,
    manifest: cajaId ? `/punto-de-venta/manifesto?c=${encodeURIComponent(cajaId)}` : '/punto-de-venta/manifesto',
    icons: { apple: '/caja-180.png' },
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: titulo },
  }
}
