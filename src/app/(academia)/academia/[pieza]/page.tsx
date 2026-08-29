import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { leerManual } from '@/lib/academia/manual'
import { piezaPorSlug, rutaDe } from '@/lib/academia/piezas'
import { capaDeSesion, puedeElegirCapa } from '@/lib/academia/capas-server'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import Rail from '@/lib/academia/Rail'
import Pieza from '@/lib/academia/Pieza'
import { tituloPagina } from '@/lib/academia/marca'
import AcademiaPie from '../AcademiaPie'

/**
 * Una pieza del manual, en su propia URL. Enlazable, con el índice al lado
 * marcando dónde se está y la pieza contigua a un clic al terminar.
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ pieza: string }> }): Promise<Metadata> {
  const { pieza } = await params
  const p = piezaPorSlug(pieza)
  return { title: tituloPagina(p?.titulo) }
}

export default async function PiezaPage({ params }: { params: Promise<{ pieza: string }> }) {
  const { pieza: slug } = await params
  if (!piezaPorSlug(slug)) notFound()

  const capa = await capaDeSesion()
  const ctx = await obtenerContextoAdmin()
  const impuesta = ctx ? !puedeElegirCapa(ctx.rol) : false
  const todas = await leerManual(capa.clave)
  const actual = todas.find(p => p.slug === slug)
  if (!actual) notFound()

  // Las visibles en esta capa. Una pieza escrita que se queda sin nada que
  // enseñar (4. Cómo se vende, para un cliente) desaparece del índice y de la
  // paginación: las contiguas se calculan sobre ESTA lista, no sobre el orden
  // completo, para que «Siguiente» no lleve nunca a una página vacía.
  const piezas = todas.filter(p => !p.escrita || p.cuerpo)
  const i = piezas.findIndex(p => p.slug === slug)
  const anterior = i > 0 ? piezas[i - 1] : undefined
  const siguiente = i >= 0 ? piezas[i + 1] : undefined

  const fuera = actual.escrita && !actual.cuerpo

  return (
    <div className="acad-shell">
      <Rail piezas={piezas} actual={slug} />

      <main className="acad-main">
        {fuera
          ? (
            /* La pieza existe pero esta capa no la deja ver. Se dice, en vez de
               un 404 que haría pensar que el enlace está roto. Y se dice
               distinto según de quién se trate: a quien puede cambiar de capa se
               le explica cómo; a quien la tiene impuesta, decirle qué se está
               perdiendo y que no puede llegar solo señalaría una puerta. */
            <>
              <p className="acad-kicker">
                {impuesta ? 'No forma parte de este manual' : `Fuera de la vista ${capa.nombre.toLowerCase()}`}
              </p>
              <h1 className="acad-h1">{actual.nombre}</h1>
              <div className="acad-note">
                {impuesta
                  ? <><strong>Esta pieza no forma parte de su manual.</strong>{' '}
                      El índice recoge todo lo que sí está disponible.</>
                  : <><strong>Esta pieza no se ve en la capa {capa.nombre.toLowerCase()}.</strong>{' '}
                      {capa.fuera} Está escrita y entera en el manual: para leerla, vuelva
                      a la vista interna con el selector de arriba.</>}
              </div>
            </>
          )
          : <Pieza pieza={actual} abiertos={capa.clave === 'interna'} />}

        <nav className="acad-saltos" aria-label="Piezas contiguas">
          {anterior
            ? (
              <Link className="acad-nav acad-salto" href={rutaDe(anterior.slug)} prefetch={false}>
                <span className="acad-salto-k">Anterior</span>
                <span className="acad-salto-v">{anterior.nombre}</span>
              </Link>
            )
            : (
              <Link className="acad-nav acad-salto" href="/academia" prefetch={false}>
                <span className="acad-salto-k">Volver</span>
                <span className="acad-salto-v">Índice del manual</span>
              </Link>
            )}
          {siguiente && (
            <Link className="acad-nav acad-salto es-siguiente" href={rutaDe(siguiente.slug)} prefetch={false}>
              <span className="acad-salto-k">Siguiente</span>
              <span className="acad-salto-v">{siguiente.nombre}</span>
            </Link>
          )}
        </nav>

        <AcademiaPie />
      </main>
    </div>
  )
}
