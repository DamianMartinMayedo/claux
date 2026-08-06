import type { Viewport } from 'next'
// App de punto de venta offline: aislada del design system del portal (regla de públicas,
// SKILL §6). Solo su hoja propia namespaced (--ca-*) sobre el reset público.
import './punto-venta-app.css'

// Sin `metadata` estático aquí: el título, el manifest y la etiqueta de iOS dependen
// de QUÉ punto de venta se está instalando, y eso solo se sabe en la página (por el
// `?c=` del enlace). Lo resuelve `metadataPunto` en page.tsx y en [slug]/page.tsx.
export const viewport: Viewport = {
  themeColor: '#0d9488',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function PuntoVentaLayout({ children }: { children: React.ReactNode }) {
  // El registro del service worker vive DENTRO de la app y no aquí: necesita saber si hay
  // una venta a medias para no recargar encima de ella tras un despliegue.
  return <div className="ca-app">{children}</div>
}
