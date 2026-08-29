import { Fragment } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { leerManual } from '@/lib/academia/manual'
import { capaDeSesion, puedeElegirCapa } from '@/lib/academia/capas-server'
import Pieza from '@/lib/academia/Pieza'
import AcademiaImprimir from '../AcademiaImprimir'
import { tituloPagina, MARCA_LARGA } from '@/lib/academia/marca'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import AcademiaPie from '../AcademiaPie'

/**
 * El manual entero de una tirada.
 *
 * Existe para lo que la lectura por piezas no cubre: buscar con el Ctrl+F del
 * navegador, leer seguido sin dar un clic por pieza y **el PDF de marca**, que
 * sale de imprimir esta página. No lleva índice lateral: la página ES el índice.
 *
 * El PDF respeta la capa activa: «Ver como vendedor» + imprimir da exactamente
 * el documento que se le puede entregar a quien vende, sin nada oculto dentro.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: tituloPagina('El manual entero') }

export default async function ManualEnteroPage() {
  const ctx = await obtenerContextoAdmin()
  const capa = await capaDeSesion()
  // Con la capa IMPUESTA (un vendedor) esto no es «una vista de» nada: es su
  // manual, y el papel que se lleva tiene que decir eso y no que está mirando
  // una versión recortada de otro documento.
  const impuesta = ctx ? !puedeElegirCapa(ctx.rol) : false
  const rotulo = capa.clave === 'interna'
    ? 'Manual interno'
    : impuesta ? `Manual · ${capa.nombre.toLowerCase()}` : `Manual · vista ${capa.nombre.toLowerCase()}`
  // Las que esta capa deja ver: leer «todo» como vendedor tiene que dar
  // exactamente el manual del vendedor, sin huecos con solo el título.
  const piezas = (await leerManual(capa.clave)).filter(p => !p.escrita || p.cuerpo)
  const apartados = piezas.reduce((n, p) => n + p.etiquetados, 0)
  const fecha = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
  const primeraFicha = piezas.findIndex(p => p.ficha)
  const ultimaFicha  = piezas.map(p => !!p.ficha).lastIndexOf(true)

  return (
    <div className="acad-shell es-suelto">
      <main className="acad-main">
        {/* Portada del PDF: no se ve en pantalla. Lleva la capa y la fecha para
            que un papel suelto diga siempre de qué documento salió. */}
        <div className="acad-print-cover">
          <p className="acad-print-marca">{MARCA_LARGA}</p>
          <p className="acad-print-titulo">
            {rotulo}
          </p>
          {/* Lo que la capa deja fuera solo se anuncia a quien puede ver el resto:
              a un vendedor, «fuera queda lo confidencial» solo le señala una puerta. */}
          {!impuesta && capa.fuera && <p className="acad-print-fuera">{capa.fuera}</p>}
          <p className="acad-print-pie">
            {piezas.length} piezas · {apartados} apartados · impreso el {fecha}
          </p>
        </div>

        <p className="acad-kicker">
          {rotulo} · el texto completo, seguido
        </p>
        <div className="acad-note">
          <strong>Todo en una página.</strong> Las {piezas.length} piezas{capa.clave === 'interna' || impuesta ? '' : ` de la vista ${capa.nombre.toLowerCase()}`}, una
          detrás de otra, para buscar con Ctrl+F o leer del tirón. Para consultar una sola,{' '}
          <Link href="/academia">el índice</Link> es más cómodo.
          {' '}Y para llevárselo: <AcademiaImprimir /> — sale con la portada, una pieza por
          página y lo que deja ver la capa actual, ni más ni menos.
        </div>

        <nav className="acad-todo-nav" aria-label="Piezas del manual">
          {piezas.map(p => (
            <a key={p.slug} className="acad-nav acad-todo-navlink" href={`#${p.slug}`}>{p.nombre}</a>
          ))}
        </nav>

        {piezas.map((p, i) => (
          /* Fragmento y no <div>: las fichas tienen que seguir siendo hermanas para
             que la línea que las separa caiga entre ellas y no en cada una. */
          <Fragment key={p.slug}>
            {i === primeraFicha && (
              <div className="acad-part2-head">
                <h1 className="acad-h1">Parte II — El catálogo</h1>
                <p className="acad-p">Cada módulo, funcionalidad y addon, con la misma estructura:
                  qué es, cómo funciona y cómo se vende.</p>
              </div>
            )}
            <Pieza pieza={p} abiertos={capa.clave === 'interna'} />
            {i === ultimaFicha && <hr className="acad-todo-corte" />}
          </Fragment>
        ))}

        <AcademiaPie />
      </main>
    </div>
  )
}
