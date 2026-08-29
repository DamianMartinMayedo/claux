import { notFound }            from 'next/navigation'
import type { Metadata }       from 'next'
import { obtenerCatalogoPublicoCache } from '@/lib/publico/catalogo-qr'
import CatalogoPublico          from './CatalogoPublico'
import PwaCatalogoRegister      from './PwaCatalogoRegister'
import './catalogo-publica.css'

// A diferencia de reservar/citas (force-dynamic, priorizan frescura del cupo),
// el catálogo prioriza CDN + offline (CONTEXTO §3): ISR corto + revalidatePath
// inmediato desde las acciones del dueño (ver revalidarPublico en catalogo.ts).
//
// `revalidate` SOLO no basta: una ruta dinámica sin generateStaticParams no entra
// en la caché de ruta y se resuelve en la función en CADA petición — es decir, el
// ISR declarado aquí llevaba tiempo siendo papel mojado y cada escaneo de QR
// pagaba el viaje entero hasta Supabase. No se prerenderiza en el build (leer el
// catálogo usa el service_role, que como variable «sensitive» de Vercel no llega
// al entorno de build), así que se sigue el mismo patrón que legal/[slug]: lista
// vacía + dynamicParams, cada negocio se genera en su PRIMERA visita —ya en
// runtime, con la clave disponible— y a partir de ahí se sirve desde caché.
export function generateStaticParams() {
  return []
}

export const dynamicParams = true

export const revalidate = 60

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const data = await obtenerCatalogoPublicoCache(slug)
  if (!data.negocio) return {}
  return {
    title: `${data.negocio.nombre} — ${data.etiquetas.catalogo}`,
    description: `${data.etiquetas.catalogo} de ${data.negocio.nombre}`,
    manifest: `/${slug}/catalogo/manifest.json`,
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon.png', type: 'image/png' },
      ],
      apple: '/simbolo-180.png',
    },
  }
}

export default async function CatalogoPublicoPage({ params }: Props) {
  const { slug } = await params
  const data = await obtenerCatalogoPublicoCache(slug)
  if (!data.negocio) notFound()

  return (
    <div className="cp-page">
      <PwaCatalogoRegister slug={slug} />
      <CatalogoPublico data={data} slug={slug} />
    </div>
  )
}
