import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { etiquetasDe, ETIQUETAS_DEFAULT } from '@/lib/sector'

// Manifest PWA por negocio (start_url apunta a SU catálogo, no al genérico).
// Instalar el catálogo lo deja como icono en el móvil del cliente final; el
// service worker (registrado desde la página) es lo que habilita el offline.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createAdminClient()
  const { data: cliente } = await db.from('clients')
    .select('nombre_empresa, sector').eq('slug', slug).maybeSingle()

  const nombre = cliente?.nombre_empresa ?? 'Catálogo'
  const etiqueta = cliente?.sector
    ? (await (async () => {
        const { data: pl } = await db.from('plantillas_sector').select('etiquetas').eq('sector', cliente.sector).maybeSingle()
        return etiquetasDe(pl?.etiquetas).catalogo
      })())
    : ETIQUETAS_DEFAULT.catalogo

  return NextResponse.json({
    name: `${nombre} — ${etiqueta}`,
    short_name: nombre,
    start_url: `/${slug}/catalogo`,
    scope: `/${slug}/catalogo`,
    display: 'standalone',
    background_color: '#faf7f2',
    theme_color: '#0d9488',
    icons: [
      { src: '/icon-catalogo-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-catalogo-512.png', sizes: '512x512', type: 'image/png' },
    ],
  })
}
