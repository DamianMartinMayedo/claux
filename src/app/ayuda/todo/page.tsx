import { Fragment } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { leerAyuda } from '@/lib/academia/publico'
import { BASE_AYUDA } from '@/lib/academia/piezas'
import Pieza from '@/lib/academia/Pieza'
import AyudaShell from '../AyudaShell'

/**
 * Todas las guías de una tirada.
 *
 * Existe para lo que la lectura por piezas no cubre: buscar con el Ctrl+F del
 * navegador, leer seguido sin dar un clic por guía y —lo que más importa en
 * Cuba— cargar una vez y consultar después sin volver a pedir nada. No lleva
 * índice lateral: la página ES el índice.
 *
 * Va con `noindex`: es el MISMO texto que las guías sueltas, y publicar las dos
 * versiones haría que compitieran entre ellas en el buscador. El canónico
 * apunta a la portada, que es la que sí se indexa.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Todas las guías',
  robots: { index: false, follow: true },
  alternates: { canonical: '/ayuda' },
}

export default async function AyudaTodoPage() {
  const piezas = await leerAyuda()
  const primeraFicha = piezas.findIndex(p => p.ficha)
  const ultimaFicha  = piezas.map(p => !!p.ficha).lastIndexOf(true)

  return (
    <AyudaShell>
      <div className="acad-shell es-suelto">
        <main className="acad-main">
          <p className="acad-kicker">Centro de ayuda · todo seguido</p>
          <div className="acad-note">
            <strong>Las {piezas.length} guías en una página.</strong> Una detrás de otra, para
            buscar con Ctrl+F o leerlas del tirón. Para consultar una sola,{' '}
            <Link href={BASE_AYUDA}>el índice</Link> es más cómodo.
          </div>

          <nav className="acad-todo-nav" aria-label="Guías">
            {piezas.map(p => (
              <a key={p.slug} className="acad-nav acad-todo-navlink" href={`#${p.slug}`}>{p.nombre}</a>
            ))}
          </nav>

          {piezas.map((p, i) => (
            /* Fragmento y no <div>: las guías tienen que seguir siendo hermanas para
               que la línea que las separa caiga entre ellas y no en cada una. */
            <Fragment key={p.slug}>
              {i === primeraFicha && (
                <div className="acad-part2-head">
                  <h1 className="acad-h1">Las guías del portal</h1>
                  <p className="acad-p">Una por cada pieza de CLAUX, todas con la misma
                    estructura: qué es, cómo funciona, qué pantallas trae y qué no hace.</p>
                </div>
              )}
              <Pieza pieza={p} comercial={false} />
              {i === ultimaFicha && <hr className="acad-todo-corte" />}
            </Fragment>
          ))}
        </main>
      </div>
    </AyudaShell>
  )
}
