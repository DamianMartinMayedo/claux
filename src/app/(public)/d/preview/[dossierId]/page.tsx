import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { obtenerDeckBorrador } from '@/app/actions/portal/dossier'
import Deck from '../../[token]/Deck'

// ── Vista previa del deck en BORRADOR — /d/preview/<dossierId> ────────────────
//
// El mismo deck que `/d/<token>`, pero gated por SESIÓN (no por token) y sin exigir
// PUBLICADO: el dueño ve el deck ensamblado ANTES de publicar, en vez de publicar a
// ciegas. Vive en el grupo `(public)` a propósito —usa el layout limpio del deck,
// sin el chrome del ERP— así que el entorno de render es idéntico al enlace real;
// el candado no está en el layout sino en `obtenerDeckBorrador` (client_id de la
// sesión). No colisiona con `/d/<token>`: ese es de UN segmento, este de dos.
//
// Dinámico: depende de la sesión, no se prerenderiza ni se cachea.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ dossierId: string }>
}

// Nunca indexable: es un borrador privado del dueño.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function DeckPreviewPage({ params }: Props) {
  const { dossierId } = await params
  const deck = await obtenerDeckBorrador(dossierId)
  if (!deck) notFound()   // sin sesión, de otro tenant, o sin snapshot → 404

  return <Deck deck={deck} borrador />
}
