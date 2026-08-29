import Link from 'next/link'
import type { Metadata } from 'next'
import { GRUPOS } from '@/lib/academia/catalogo'
import { rutaDe, PARTES_PREVISTAS } from '@/lib/academia/piezas'
import { leerManual, duracion } from '@/lib/academia/manual'
import Flecha from '@/lib/academia/Flecha'
import Tarjeta from '@/lib/academia/Tarjeta'
import { ATAJOS, anclaDe, rutaDeAtajo } from '@/lib/academia/atajos'
import { capaDeSesion, puedeElegirCapa } from '@/lib/academia/capas-server'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import { tituloPagina } from '@/lib/academia/marca'
import AcademiaPie from './AcademiaPie'

/**
 * Portada del manual. Aquí llegan dos personas distintas y las dos tienen que
 * salir en un clic:
 *
 *  · quien viene CON UN CLIENTE DELANTE y necesita una respuesta ya — para esa
 *    están los atajos, que no llevan a una pieza sino al apartado exacto;
 *  · quien viene A APRENDERSE ESTO — para esa está el recorrido, que dice en qué
 *    orden se lee y cuánto cuesta cada tramo.
 *
 * Por eso las partes narradas no se pintan como una tarjeta más: son los tramos
 * del recorrido. La rejilla de tarjetas se reserva a la Parte II, que es lo único
 * que se consulta suelto.
 *
 * El vestido es el de la LANDING a propósito (banda de marca a sangre, rótulo de
 * sección, tarjetas con su icono de color, banda de cierre): esta es la puerta de
 * entrada al manual, no una pieza de lectura, y quien la abre viene de ver la web
 * pública de CLAUX. Dentro, cada pieza vuelve al tipo sobrio de leer.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: tituloPagina() }

export default async function AcademiaPortada() {
  const capa = await capaDeSesion()
  const ctx = await obtenerContextoAdmin()
  // Con la capa impuesta esto no es «una vista de» otro documento: es el manual
  // de quien lo abre, y la portada tiene que hablarle de él, no de lo que falta.
  const impuesta = ctx ? !puedeElegirCapa(ctx.rol) : false
  // Una pieza escrita que se queda sin nada visible en esta capa no se anuncia:
  // la portada tiene que ser el índice de lo que HAY, no de lo que no se puede
  // abrir.
  const piezas = (await leerManual(capa.clave)).filter(p => !p.escrita || p.cuerpo)
  const primeraFicha = piezas.findIndex(p => p.ficha)
  const ultimaFicha  = piezas.map(p => !!p.ficha).lastIndexOf(true)
  const antes  = primeraFicha < 0 ? piezas : piezas.slice(0, primeraFicha)
  const fichas = primeraFicha < 0 ? []     : piezas.slice(primeraFicha, ultimaFicha + 1)
  const luego  = primeraFicha < 0 ? []     : piezas.slice(ultimaFicha + 1)

  const escritas = piezas.filter(p => p.cuerpo).length
  const minutos  = piezas.reduce((n, p) => n + p.minutos, 0)
  // El apartado es la unidad real del manual: lo que lleva etiqueta es lo que
  // luego cada capa de acceso deja pasar o no. Contarlos así es contar lo mismo
  // que cuenta el filtro, en vez de una cifra parecida.
  const apartados = piezas.reduce((n, p) => n + p.etiquetados, 0)
  const primera = piezas.find(p => p.cuerpo)

  // Un atajo apunta a un encabezado por su texto: si alguien lo renombra, el
  // ancla deja de existir. Antes que llevar a ninguna parte, no se pinta.
  //
  // Y son una ayuda para vender: en una capa que no ve lo comercial el bloque
  // entero sobra, aunque un par de anclas sigan existiendo.
  const anclas = new Set(piezas.flatMap(p => [...p.bloques, ...p.apartados].map(h => h.id)))
  const atajos = capa.ve.includes('vender') ? ATAJOS.filter(a => anclas.has(anclaDe(a))) : []

  // La promesa de la portada cambia con la capa: a un cliente no se le anuncia un
  // manual «para vender», porque justo eso es lo que no va a encontrar dentro.
  const paraQue = capa.ve.includes('operar')
    ? 'Todo lo que hay que saber para explicar, vender y sostener CLAUX.'
    : capa.ve.includes('vender')
      ? 'Todo lo que hay que saber para explicar y vender CLAUX.'
      : 'Qué es CLAUX y qué hace cada pieza, contada una por una.'

  // El recorrido: las partes narradas en su orden, con el catálogo intercalado
  // donde toca. Sale de la misma lista que el índice lateral, así que una parte
  // nueva se añade aquí sola.
  const tramos = [
    ...antes.map(p => ({ href: rutaDe(p.slug), titulo: p.titulo, nota: p.resumen, meta: duracion(p.minutos) })),
    {
      href: '#catalogo',
      titulo: 'Parte II — El catálogo',
      nota: 'Cada módulo, funcionalidad y addon con la misma estructura: qué es, qué hace, cómo se conecta, cómo se vende y qué no hace.',
      meta: `${fichas.length} fichas`,
    },
    ...luego.map(p => ({ href: rutaDe(p.slug), titulo: p.titulo, nota: p.resumen, meta: duracion(p.minutos) })),
  ]

  return (
    <>
      {/* Banda de marca a sangre: va FUERA del shell porque el shell centra a
          1180 px y una banda que no llega a los bordes se lee como una tarjeta
          gigante, no como cabecera. */}
      <section className="acad-hero">
        <div className="acad-hero-in">
          <p className="acad-hero-kicker">
            {capa.clave === 'interna'
              ? 'Uso interno · todo el producto, sin filtros'
              : impuesta
                ? 'Todo el producto, y cómo se vende'
                : `Vista ${capa.nombre.toLowerCase()} · ${capa.quien.toLowerCase()}`}
          </p>
          <h1 className="acad-hero-title">
            El manual de CLAUX, <span className="acad-hero-realce">de punta a punta</span>.
          </h1>
          <p className="acad-hero-lead">
            {paraQue} El texto se escribe a mano; el catálogo y los precios se leen del propio
            sistema, así que no envejecen por su cuenta.
          </p>
          <div className="acad-hero-acciones">
            {primera && (
              <Link className="btn btn-primary btn-lg" href={rutaDe(primera.slug)} prefetch={false}>
                Empezar por el principio<Flecha />
              </Link>
            )}
            {fichas.length > 0 && (
              <a className="btn btn-ghost btn-lg" href="#catalogo">Ir al catálogo</a>
            )}
          </div>
          <p className="acad-hero-tip">Pulse «/» para buscar en todo el manual</p>

          <dl className="acad-cifras">
            <div className="acad-cifra">
              <dt className="acad-cifra-n">{escritas === piezas.length ? piezas.length : `${escritas}/${piezas.length}`}</dt>
              <dd className="acad-cifra-t">piezas escritas</dd>
            </div>
            <div className="acad-cifra">
              <dt className="acad-cifra-n">{apartados}</dt>
              <dd className="acad-cifra-t">apartados, cada uno con su audiencia</dd>
            </div>
            <div className="acad-cifra">
              <dt className="acad-cifra-n">{duracion(minutos)}</dt>
              <dd className="acad-cifra-t">de lectura de punta a punta</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="acad-shell es-suelto">
        <main className="acad-main es-portada">
          {atajos.length > 0 && (
            <section className="acad-atajos">
              <div className="acad-atajos-head">
                <p className="acad-sec-label">Respuesta rápida</p>
                <h2 className="acad-portada-grupo-t es-sub">Con el cliente delante</h2>
                <p className="acad-portada-grupo-n">
                  Las seis situaciones que más se repiten, cada una directa al apartado que la resuelve.
                </p>
              </div>
              <div className="acad-atajos-grid">
                {atajos.map(a => (
                  <Link className="acad-nav acad-atajo" key={a.situacion}
                        href={rutaDeAtajo(a)} prefetch={false}>
                    <span className="acad-atajo-sit">«{a.situacion}»</span>
                    <span className="acad-atajo-donde">{a.donde}<Flecha /></span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="acad-portada-grupo">
            <div className="acad-portada-grupo-head">
              <p className="acad-sec-label">El recorrido</p>
              <h2 className="acad-portada-grupo-t">Por dónde se empieza</h2>
              <p className="acad-portada-grupo-n">
                En este orden: primero el marco, después cada pieza por separado y al final cómo se
                lleva a la calle.
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
            <section id="catalogo" className="acad-catalogo">
              <div className="acad-portada-grupo-head es-parte">
                <p className="acad-sec-label">Parte II</p>
                <h2 className="acad-portada-grupo-t">El catálogo, ficha por ficha</h2>
                <p className="acad-portada-grupo-n">
                  Todas siguen la misma plantilla, así que se aprende una y se saben leer
                  las {fichas.length}.
                </p>
              </div>
              {GRUPOS.map(g => {
                const items = fichas.filter(p => p.ficha?.tipo === g.tipo)
                if (items.length === 0) return null
                return (
                  <div className="acad-portada-grupo" key={g.tipo}>
                    <div className="acad-portada-grupo-head">
                      <h3 className="acad-portada-grupo-t es-sub">{g.titulo}</h3>
                      <p className="acad-portada-grupo-n">{g.nota}</p>
                    </div>
                    <div className="acad-portada-grid">
                      {items.map(p => <Tarjeta key={p.slug} pieza={p} />)}
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {PARTES_PREVISTAS.length > 0 && (
            <section className="acad-portada-grupo">
              <div className="acad-portada-grupo-head">
                <h2 className="acad-portada-grupo-t es-sub">Lo que falta por escribir</h2>
                <p className="acad-portada-grupo-n">
                  El esqueleto está cerrado; estas partes todavía no tienen texto.
                </p>
              </div>
              <div className="acad-portada-grid">
                {PARTES_PREVISTAS.map(p => (
                  <div className="acad-falta" key={p.titulo}>
                    <span className="acad-card-nombre">{p.titulo}</span>
                    <span className="acad-card-res">{p.resumen}</span>
                    <span className="acad-card-pend">En preparación</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Cierre: la única acción de la portada que no es entrar a leer, sino
              llevarse el manual. Va al final porque es lo que se hace DESPUÉS de
              ver que esto existe, y en banda porque si no, no se ve. */}
          <section className="acad-cierre">
            <h2 className="acad-cierre-t">El manual entero, en un archivo</h2>
            <p className="acad-cierre-p">
              Las {piezas.length} piezas seguidas en una sola página: para buscar con Ctrl+F, leerlo
              del tirón o guardarlo en PDF. El archivo sale con{' '}
              {capa.clave === 'interna' || impuesta ? 'el manual completo' : `la vista ${capa.nombre.toLowerCase()}`},
              tal como se está viendo aquí.
            </p>
            <Link className="btn btn-primary" href="/academia/todo" prefetch={false}>
              Abrir el manual entero<Flecha />
            </Link>
          </section>

          <AcademiaPie />
        </main>
      </div>
    </>
  )
}
