import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Reservas — CLAUX',
  description: 'Reserva tu mesa',
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return children
}
