import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { rutaDe, piezaPorSlug, BASE_AYUDA } from '@/lib/academia/piezas'
import { leerAyuda } from '@/lib/academia/publico'
import Rail from '@/lib/academia/Rail'
import Pieza from '@/lib/academia/Pieza'
import AyudaShell from '../AyudaShell'
import { jsonLd } from '../datos'
import { SITIO } from '@/lib/publico/sitio'

/**
 * Una guía del centro de ayuda, en su propia URL.
 *
 * Es la misma pieza del manual, filtrada por la capa `cliente` y dicha con las
 * palabras de fuera. Con el índice al lado —el mismo del manual— y la guía
 * contigua a un clic al terminar.
 *
 * Una pieza que existe pero no deja nada visible para un cliente (la Parte III,
 * que es cómo se vende) da **404 y no un aviso**. Dentro del manual, a quien
 * cambia de capa se le explica que hay algo que su vista no alcanza; aquí eso
 * sería anunciar en una web pública que existe material reservado y dónde está.
 * Para un buscador, además, 404 es la respuesta correcta: esa URL no es una
 * página de este sitio.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ pieza: string }> }): Promise<Metadata> {
  const { pieza } = await params
  const p = piezaPorSlug(pieza)
  if (!p) return {}
  // El nombre visible puede venir del catálogo en vivo, pero el título de la
  // pestaña se arma antes de leer la BD: aquí basta el del esqueleto, ya en
  // habla pública.
  const { titulo, resumen } = p.publico ?? { titulo: p.titulo, resumen: p.resumen }
  return {
    title: titulo,
    description: resumen,
    alternates: { canonical: rutaDe(p.slug, BASE_AYUDA) },
  }
}

export default async function AyudaPiezaPage({ params }: { params: Promise<{ pieza: string }> }) {
  const { pieza: slug } = await params
  if (!piezaPorSlug(slug)) notFound()

  const piezas = await leerAyuda()
  const actual = piezas.find(p => p.slug === slug)
  if (!actual) notFound()

  const i = piezas.findIndex(p => p.slug === slug)
  const anterior = i > 0 ? piezas[i - 1] : undefined
  const siguiente = piezas[i + 1]

  const url = `${SITIO}${rutaDe(slug, BASE_AYUDA)}`
  const datos = jsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        headline: actual.nombre,
        description: actual.resumen,
        url,
        inLanguage: 'es',
        isPartOf: { '@type': 'CollectionPage', name: 'Centro de ayuda de CLAUX', url: `${SITIO}/ayuda` },
        publisher: { '@type': 'Organization', name: 'CLAUX', url: SITIO },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Ayuda', item: `${SITIO}/ayuda` },
          { '@type': 'ListItem', position: 2, name: actual.nombre, item: url },
        ],
      },
    ],
  })

  return (
    <AyudaShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: datos }} />
      <div className="acad-shell">
        <Rail piezas={piezas} actual={slug} base={BASE_AYUDA} publico />

        <main className="acad-main">
          {/* `abiertos` no: fuera del equipo, lo `avanzado` empieza plegado. Quien
              viene a resolver una duda concreta no quiere el detalle fino delante,
              y el que lo quiera lo abre — sigue estando ahí, en su sitio. */}
          <Pieza pieza={actual} comercial={false} />

          <nav className="acad-saltos" aria-label="Guías contiguas">
            {anterior
              ? (
                <Link className="acad-nav acad-salto" href={rutaDe(anterior.slug, BASE_AYUDA)} prefetch={false}>
                  <span className="acad-salto-k">Anterior</span>
                  <span className="acad-salto-v">{anterior.nombre}</span>
                </Link>
              )
              : (
                <Link className="acad-nav acad-salto" href={BASE_AYUDA} prefetch={false}>
                  <span className="acad-salto-k">Volver</span>
                  <span className="acad-salto-v">Centro de ayuda</span>
                </Link>
              )}
            {siguiente && (
              <Link className="acad-nav acad-salto es-siguiente" href={rutaDe(siguiente.slug, BASE_AYUDA)} prefetch={false}>
                <span className="acad-salto-k">Siguiente</span>
                <span className="acad-salto-v">{siguiente.nombre}</span>
              </Link>
            )}
          </nav>

          <div className="acad-note">
            <strong>¿Te falta algo de esta guía?</strong>{' '}
            Si ya usas CLAUX, escríbenos desde el portal —menú de tu cuenta, «Ayuda y soporte»—.
            Si todavía no, desde <a href="mailto:contacto@claux.es">contacto@claux.es</a>.
          </div>
        </main>
      </div>
    </AyudaShell>
  )
}
