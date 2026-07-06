import type { Metadata } from 'next'
// Reset mínimo propio. Las rutas públicas por-negocio (menú/reservar/citas) NO
// cargan globals.css: quedan libres del peso del portal (regla de públicas,
// CONTEXTO §3 / skills/ui/SKILL.md §6). Cada ruta añade su hoja (`catalogo-publica.css`,
// `reserva-publica.css`) con su paleta propia sobre este reset.
import './public-base.css'

export const metadata: Metadata = {
  title: 'Reservas — CLAUX',
  description: 'Reserva tu mesa',
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return children
}
