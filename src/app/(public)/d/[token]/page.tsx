import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { obtenerDeckPublico } from '@/app/actions/portal/dossier'
import Deck from './Deck'

// ── Deck público del dossier — /d/<token> ────────────────────────────────────
//
// RUTA `/d/`, no `/[slug]/…`: funciona para un cliente SIN slug y no filtra la
// identidad del negocio en la URL. INVARIANTE que no vive aquí: `/d/` no colisiona
// con `(public)/[slug]/` porque los slugs exigen ≥2 caracteres (guardarSlug).
//
// El RENDER del deck vive en `Deck.tsx`, compartido con la vista previa en borrador
// (`/d/preview/<id>`): esta ruta solo resuelve el token y delega. Así el dueño
// previsualiza exactamente lo que verá el inversor.
//
// Snapshot CONGELADO → sin revalidación por tiempo; se revalida por evento.
export const revalidate = false

interface Props {
  params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params
  const deck = await obtenerDeckPublico(token)
  if (!deck) return { robots: { index: false, follow: false } }
  return {
    title: `${deck.nombre} — Dossier`,
    description: `Presentación de ${deck.nombre} para inversores.`,
    // Enlace privado (capability URL): no se indexa ni deja el token en el Referer.
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon.png', type: 'image/png' },
      ],
    },
  }
}

export default async function DeckPage({ params }: Props) {
  const { token } = await params
  const deck = await obtenerDeckPublico(token)
  if (!deck) notFound()   // despublicado o revocado → 404

  return <Deck deck={deck} />
}
