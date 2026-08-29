import Link from 'next/link'
import type { Metadata } from 'next'
import { gruposDe } from '@/lib/academia/catalogo'
import { rutaDe, BASE_AYUDA } from '@/lib/academia/piezas'
import { duracion } from '@/lib/academia/manual'
import { leerAyuda } from '@/lib/academia/publico'
import Flecha from '@/lib/academia/Flecha'
import Tarjeta from '@/lib/academia/Tarjeta'
import AyudaShell from './AyudaShell'
import { jsonLd } from './datos'
import { SITIO } from '@/lib/publico/sitio'

/**
 * Portada del centro de ayuda.
 *
 * Aquí llegan dos personas y las dos tienen que salir en un clic: quien YA USA
 * CLAUX y busca cómo se hace algo —para esa está la rejilla de guías, una por
 * pieza del portal, con las pantallas que trae dentro—, y quien todavía no lo
 * usa y llegó desde una búsqueda —para esa está «Qué es CLAUX» al principio del
 * recorrido—.
 *
 * Lo que NO hay es buscador. En el manual interno lo hay porque el índice de
 * búsqueda se descarga aparte y quien lo usa está dentro; aquí, la página tiene
 * que servir sin JS y con conexión mala, y una portada que lista TODAS las guías
 * con sus pantallas es a la vez el índice, lo que indexa el buscador de fuera y
 * lo que se puede recorrer con el Ctrl+F del navegador.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: { absolute: 'Centro de ayuda de CLAUX' },
  description:
    'Cómo se usa CLAUX, guía por guía: qué hace cada pieza del portal, dónde está y qué esperar de ella. Sin registro.',
  alternates: { canonical: '/ayuda' },
}

export default async function AyudaPortada() {
  const piezas = await leerAyuda()
  const grupos = gruposDe(true)

  const primeraFicha = piezas.findIndex(p => p.ficha)
  const ultimaFicha  = piezas.map(p => !!p.ficha).lastIndexOf(true)
  const antes  = primeraFicha < 0 ? piezas : piezas.slice(0, primeraFicha)
  const fichas = primeraFicha < 0 ? []     : piezas.slice(primeraFicha, ultimaFicha + 1)
  const luego  = primeraFicha < 0 ? []     : piezas.slice(ultimaFicha + 1)

  const minutos   = piezas.reduce((n, p) => n + p.minutos, 0)
  const apartados = piezas.reduce((n, p) => n + p.etiquetados, 0)
  const primera   = piezas[0]

  // El recorrido sale de la misma lista que la rejilla, con el bloque de guías
  // intercalado donde toca: si mañana otra parte del manual pasa a verse desde
  // fuera, aparece aquí sola.
  const tramos = [
    ...antes.map(p => ({ href: rutaDe(p.slug, BASE_AYUDA), titulo: p.titulo, nota: p.resumen, meta: duracion(p.minutos) })),
    {
      href: '#guias',
      titulo: 'Las guías del portal',
      nota: 'Una por cada pieza de CLAUX, todas con la misma estructura: qué es, cómo funciona, qué pantallas trae y qué NO hace.',
      meta: `${fichas.length} guías`,
    },
    ...luego.map(p => ({ href: rutaDe(p.slug, BASE_AYUDA), titulo: p.titulo, nota: p.resumen, meta: duracion(p.minutos) })),
  ]

  const datos = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Centro de ayuda de CLAUX',
    url: `${SITIO}/ayuda`,
    inLanguage: 'es',
    description:
      'Guías de uso de CLAUX: qué hace cada pieza del portal, dónde está y qué esperar de ella.',
    isPartOf: { '@type': 'WebSite', name: 'CLAUX', url: SITIO },
    hasPart: piezas.map(p => ({
      '@type': 'TechArticle',
      headline: p.nombre,
      description: p.resumen,
      url: `${SITIO}${rutaDe(p.slug, BASE_AYUDA)}`,
      inLanguage: 'es',
    })),
  })

  return (
    <AyudaShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: datos }} />

      {/* Banda de marca a sangre: va FUERA del shell de lectura porque el shell
          centra a 1180 px y una banda que no llega a los bordes se lee como una
          tarjeta gigante, no como cabecera. */}
      <section className="acad-hero">
        <div className="acad-hero-in">
          <p className="acad-hero-kicker">Centro de ayuda · abierto, sin registro</p>
          <h1 className="acad-hero-title">
            Cómo se usa CLAUX, <span className="acad-hero-realce">pantalla a pantalla</span>.
          </h1>
          <p className="acad-hero-lead">
            Las mismas guías que lee nuestro equipo, sin la parte comercial. Qué hace cada pieza
            del portal, dónde está en el menú, qué pantallas trae dentro y —esto también— qué no
            hace. Escritas a mano; los nombres salen del propio sistema.
          </p>
          <div className="acad-hero-acciones">
            {primera && (
              <Link className="btn btn-primary btn-lg" href={rutaDe(primera.slug, BASE_AYUDA)} prefetch={false}>
                {primera.nombre}<Flecha />
              </Link>
            )}
            {fichas.length > 0 && (
              <a className="btn btn-ghost btn-lg" href="#guias">Ver todas las guías</a>
            )}
          </div>

          <dl className="acad-cifras">
            <div className="acad-cifra">
              <dt className="acad-cifra-n">{piezas.length}</dt>
              <dd className="acad-cifra-t">guías</dd>
            </div>
            <div className="acad-cifra">
              <dt className="acad-cifra-n">{apartados}</dt>
              <dd className="acad-cifra-t">apartados explicados uno a uno</dd>
            </div>
            <div className="acad-cifra">
              <dt className="acad-cifra-n">{duracion(minutos)}</dt>
              <dd className="acad-cifra-t">de lectura, si se lee entero</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="acad-shell es-suelto">
        <main className="acad-main es-portada">
          <section className="acad-portada-grupo">
            <div className="acad-portada-grupo-head">
              <p className="acad-sec-label">Por dónde empezar</p>
              <h2 className="acad-portada-grupo-t">Si es tu primera vez aquí</h2>
              <p className="acad-portada-grupo-n">
                En este orden: primero qué es esto y cómo encaja todo, después la guía de la pieza
                que estés usando.
              </p>
            </div>
            <ol className="acad-ruta">
              {tramos.map((t, i) => (
                <li className="acad-ruta-paso" key={t.href}>
                  <Link className="acad-nav acad-ruta-link" href={t.href} prefetch={false}>
                    <span className="acad-ruta-node">{i + 1}</span>
                    <span className="acad-ruta-cuerpo">
                      <span className="acad-ruta-t">{t.titulo}</span>
                      <span className="acad-ruta-n">{t.nota}</span>
                    </span>
                    <span className="acad-ruta-meta">{t.meta}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          {fichas.length > 0 && (
            <section id="guias" className="acad-catalogo">
              <div className="acad-portada-grupo-head es-parte">
                <p className="acad-sec-label">Las guías</p>
                <h2 className="acad-portada-grupo-t">Una por cada pieza del portal</h2>
                <p className="acad-portada-grupo-n">
                  Todas siguen la misma estructura, así que se aprende una y se saben leer
                  las {fichas.length}. Debajo de cada nombre están las pantallas que trae dentro:
                  si reconoces una, esa es tu guía.
                </p>
              </div>
              {grupos.map(g => {
                const items = fichas.filter(p => p.ficha?.tipo === g.tipo)
                if (items.length === 0) return null
                return (
                  <div className="acad-portada-grupo" key={g.tipo}>
                    <div className="acad-portada-grupo-head">
                      <h3 className="acad-portada-grupo-t es-sub">{g.titulo}</h3>
                      <p className="acad-portada-grupo-n">{g.nota}</p>
                    </div>
                    <div className="acad-portada-grid">
                      {items.map(p => (
                        <Tarjeta key={p.slug} pieza={p} base={BASE_AYUDA} comercial={false} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {/* La salida de quien no encontró lo suyo. Va antes del cierre porque es
              lo que se busca al no encontrar, no al terminar de leer. */}
          <div className="acad-note">
            <strong>¿No está lo que buscas?</strong>{' '}
            Si ya usas CLAUX, escríbenos desde el portal —menú de tu cuenta, arriba a la
            derecha, «Ayuda y soporte»—. Si todavía no eres cliente, escribe a{' '}
            <a href="mailto:contacto@claux.es">contacto@claux.es</a>.
          </div>

          <section className="acad-cierre">
            <h2 className="acad-cierre-t">Todas las guías en una sola página</h2>
            <p className="acad-cierre-p">
              Las {piezas.length} seguidas, para buscar con Ctrl+F, leerlas del tirón o dejarlas
              cargadas una vez y consultarlas después sin volver a pedir nada.
            </p>
            <Link className="btn btn-primary" href={`${BASE_AYUDA}/todo`} prefetch={false}>
              Abrir la guía completa<Flecha />
            </Link>
          </section>
        </main>
      </div>
    </AyudaShell>
  )
}
