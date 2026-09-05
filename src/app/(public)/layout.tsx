import type { Metadata } from 'next'
// Reset mínimo propio. Las rutas públicas por-negocio (menú/reservar/citas) NO
// cargan el design system: quedan libres del peso del portal (regla de públicas,
// CONTEXTO §3 / skills/ui/SKILL.md §6). Cada ruta añade su hoja (`catalogo-publica.css`,
// `reserva-publica.css`) con su paleta propia sobre este reset.
import './public-base.css'

export const metadata: Metadata = {
  // ⚠️ Este título es el RESPALDO de TODO el grupo público, no el de una página.
  // Decía «Reservas — CLAUX» (resto de cuando aquí solo vivía la reserva de mesa)
  // y se lo comía cualquier ruta que no pusiera el suyo: la propuesta de un lead
  // se descargaba como «Reservas — CLAUX.pdf», porque el nombre del PDF ES el
  // título del documento. Cada página pone el suyo; este solo cubre el hueco.
  // `absolute` para saltarse el «%s | CLAUX» del layout raíz: sin eso el
  // respaldo sale como «CLAUX | CLAUX».
  title: { absolute: 'CLAUX' },
  description: 'CLAUX — la plataforma para digitalizar tu negocio.',
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
