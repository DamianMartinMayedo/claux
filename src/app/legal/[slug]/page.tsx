import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicHeader, PublicFooter } from '@/components/publico/Chrome'
import { leerSetting } from '@/lib/settings'
import { PAGINAS_LEGALES, parsearLegal, type BloqueLegal } from '@/lib/publico/legal'
import VolverLink from './VolverLink'

interface Props {
  params: Promise<{ slug: string }>
}

// NO se prerenderizan en el build: leer el texto usa el service_role de Supabase,
// que como variable «sensitive» de Vercel NO llega al entorno de build (solo al
// runtime). Con generateStaticParams vacío + dynamicParams, cada página se genera
// en su PRIMERA visita —ya en runtime, con la clave disponible— y se cachea con
// ISR (revalidate abajo). La lista blanca la sigue aplicando el componente vía
// notFound(): cualquier slug fuera de PAGINAS_LEGALES es 404 igual que antes.
export function generateStaticParams() {
  return []
}

export const dynamicParams = true

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
        <VolverLink />

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
