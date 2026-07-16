import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PublicHeader, PublicFooter } from '@/components/publico/Chrome'
import { leerSetting } from '@/lib/settings'
import { PAGINAS_LEGALES, parsearLegal, type BloqueLegal } from '@/lib/publico/legal'

interface Props {
  params: Promise<{ slug: string }>
}

// Las tres páginas se prerenderizan; cualquier otro slug es 404 (no hay
// `dynamicParams` que valga: el mapa de PAGINAS_LEGALES es la lista blanca).
export function generateStaticParams() {
  return Object.keys(PAGINAS_LEGALES).map((slug) => ({ slug }))
}

export const dynamicParams = false

// El texto lo edita el equipo desde /admin/configuracion; `guardarSetting`
// revalida estas rutas al guardar, así que el cambio sale sin redeploy.
export const revalidate = 3600

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const pagina = PAGINAS_LEGALES[slug]
  if (!pagina) return {}
  return {
    title: pagina.titulo,
    description: pagina.descripcion,
    alternates: { canonical: `/legal/${slug}` },
  }
}

export default async function LegalPage({ params }: Props) {
  const { slug } = await params
  const pagina = PAGINAS_LEGALES[slug]
  if (!pagina) notFound()

  const texto = await leerSetting(pagina.clave, '')
  const bloques = parsearLegal(texto)

  return (
    <div className="ld-page">
      <PublicHeader />
      <main className="lg-page">
        <Link href="/" className="lg-volver">
          <ArrowLeft size={16} />
          Volver al inicio
        </Link>

        <h1 className="lg-titulo">{pagina.titulo}</h1>

        {bloques.length > 0 ? (
          <div className="lg-cuerpo">
            {bloques.map((b, i) => (
              <Bloque key={i} bloque={b} />
            ))}
          </div>
        ) : (
          <p className="lg-vacio">
            Estamos preparando este texto. Si necesitas esta información ahora,
            escríbenos a{' '}
            <a href="mailto:contacto@claux.es" className="lg-enlace">
              contacto@claux.es
            </a>
            .
          </p>
        )}
      </main>
      <PublicFooter />
    </div>
  )
}

// El texto se pinta como elementos JSX, nunca con dangerouslySetInnerHTML:
// React escapa el contenido, así que lo que se escriba en el admin no puede
// inyectar HTML en una página pública.
function Bloque({ bloque }: { bloque: BloqueLegal }) {
  switch (bloque.tipo) {
    case 'h2':
      return <h2 className="lg-h2">{bloque.texto}</h2>
    case 'h3':
      return <h3 className="lg-h3">{bloque.texto}</h3>
    case 'lista':
      return (
        <ul className="lg-lista">
          {bloque.items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      )
    default:
      return <p className="lg-p">{bloque.texto}</p>
  }
}
