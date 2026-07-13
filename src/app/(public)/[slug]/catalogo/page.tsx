import { notFound }            from 'next/navigation'
import type { Metadata }       from 'next'
import { obtenerCatalogoPublico } from '@/app/actions/portal/catalogo'
import CatalogoPublico          from './CatalogoPublico'
import PwaCatalogoRegister      from './PwaCatalogoRegister'
import './catalogo-publica.css'

// A diferencia de reservar/citas (force-dynamic, priorizan frescura del cupo),
// el catálogo prioriza CDN + offline (CONTEXTO §3): ISR corto + revalidatePath
// inmediato desde las acciones del dueño (ver revalidarPublico en catalogo.ts).
export const revalidate = 60

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const data = await obtenerCatalogoPublico(slug)
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
  const data = await obtenerCatalogoPublico(slug)
  if (!data.negocio) notFound()

  return (
    <div className="cp-page">
      <PwaCatalogoRegister slug={slug} />
      <CatalogoPublico data={data} slug={slug} />
    </div>
  )
}
