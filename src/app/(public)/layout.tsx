import type { Metadata } from 'next'
// Reset mínimo propio. Las rutas públicas por-negocio (menú/reservar/citas) NO
// cargan globals.css: quedan libres del peso del portal (regla de públicas,
// CONTEXTO §3 / skills/ui/SKILL.md §6). Cada ruta añade su hoja (`catalogo-publica.css`,
// `reserva-publica.css`) con su paleta propia sobre este reset.
import './public-base.css'

export const metadata: Metadata = {
  title: 'Reservas — CLAUX',
  description: 'Reserva tu mesa',
  // Favicon para TODAS las rutas públicas (no hay app/favicon.ico y estas rutas
  // están aisladas del portal): sin esto el enlace compartido no muestra icono.
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.png', type: 'image/png' },
    ],
  },
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return children
}
