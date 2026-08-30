import { pastillaDe } from './catalogo'
import type { PiezaLeida } from './manual'
import Markdown from './Markdown'
import { nombresNivelManual } from './precios'
import { NIVELES } from '@/lib/niveles'
import { MONEDAS_CLAUX, importeClaux } from '@/lib/moneda-claux'

/**
 * Una pieza del manual: su cabecera y su texto.
 *
 * La pintan las CUATRO vistas que enseñan una pieza —la página del manual, el
 * manual entero de una tirada, y sus dos equivalentes en el centro de ayuda
 * público—, así que una ficha se ve igual en todas sin duplicar nada. Por eso
 * vive en `lib/academia/` y no dentro de una ruta: no es de `/academia`, es del
 * manual.
 *
 * Las partes (I, III…) traen su propio título dentro del Markdown; las fichas
 * del catálogo no: la cabecera se pinta con los datos del sistema (nombre,
 * precios, páginas), que son los que no deben desfasarse.
 *
 * `abiertos` es si los apartados `avanzado` se pintan desplegados. Lo decide la
 * capa y por eso llega de fuera: el equipo lee el manual entero, quien vende lo
 * abre cuando lo busca.
 *
 * `comercial` es si esta vista VENDE. Gobierna dos cosas que van juntas: los
 * precios y las palabras. La capa `cliente` dice, con
 * todas las letras, que fuera queda «todo lo comercial —argumentario, objeciones,
 * PRECIOS—», y la cabecera de la ficha la contradecía: el texto se filtraba pero
 * los tres importes seguían ahí, porque no salen del Markdown sino del catálogo
 * en vivo. En el centro de ayuda, además, cambiaría el trabajo de la página: se
 * viene a saber cómo se usa, no cuánto vale. Y la pastilla del tipo cambia con
 * él: «Addon» es una palabra de vender (`pastillaDe`).
 */

export default async function Pieza(
  { pieza, abiertos = false, comercial = true }:
  { pieza: PiezaLeida; abiertos?: boolean; comercial?: boolean },
) {
  const f = pieza.ficha
  const nombresNivel = await nombresNivelManual()

  if (!f) {
    return (
      <article className="acad-parte" id={pieza.slug}>
        {pieza.cuerpo
          ? <Markdown source={pieza.cuerpo} slug={pieza.slug}
                      avanzados={pieza.avanzados} abiertos={abiertos} />
          : <p className="acad-p acad-pend-txt">{pieza.titulo} en preparación.</p>}
      </article>
    )
  }

  return (
    <article className="acad-ficha" id={pieza.slug}>
      <div className="acad-ficha-head">
        <div className="acad-ficha-titlerow">
          <h1 className="acad-ficha-title">{pieza.nombre}</h1>
          <span className={`acad-pill acad-pill-${f.tipo}`}>{pastillaDe(f.tipo, !comercial)}</span>
        </div>
        <p className="acad-ficha-resumen">{f.resumen}</p>
        <div className="acad-ficha-meta">
          {comercial && pieza.precio && NIVELES.map(n => (
            <span className="acad-chip" key={n}>
              <span className="acad-chip-k">{nombresNivel[n]}</span>
              <span className="acad-chip-v">
                {MONEDAS_CLAUX.map(m => importeClaux(pieza.precio!.precios[m][n], m)).join(' · ')}
              </span>
            </span>
          ))}
          {/* Se vende, pero el catálogo no la encuentra: mejor un hueco que un
              precio inventado. */}
          {comercial && f.clave && !pieza.precio && (
            <span className="acad-chip">
              <span className="acad-chip-k">Precio</span>
              <span className="acad-chip-v">sin leer del catálogo</span>
            </span>
          )}
          {comercial && pieza.precio?.activo === false && (
            <span className="acad-chip">
              <span className="acad-chip-k">Estado</span>
              <span className="acad-chip-v">archivada · no se vende</span>
            </span>
          )}
          {f.donde && (
            <span className="acad-chip">
              <span className="acad-chip-k">Dónde está</span>
              <span className="acad-chip-v">{f.donde}</span>
            </span>
          )}
          {f.paginas && (
            <span className="acad-chip">
              <span className="acad-chip-k">Páginas</span>
              <span className="acad-chip-v">{f.paginas.length}</span>
            </span>
          )}
        </div>
        {f.paginas && <p className="acad-ficha-pages">{f.paginas.join(' · ')}</p>}
        {pieza.apartados.length > 0 && (
          <nav className="acad-ficha-nav" aria-label={`Apartados de ${pieza.nombre}`}>
            {pieza.apartados.map(h => (
              <a key={h.id} className="acad-nav acad-ficha-navlink" href={`#${h.id}`}>{h.texto}</a>
            ))}
          </nav>
        )}
      </div>

      {pieza.cuerpo
        ? (
          <div className="acad-ficha-body">
            <Markdown source={pieza.cuerpo} slug={pieza.slug}
                      avanzados={pieza.avanzados} abiertos={abiertos} />
          </div>
        )
        : (
          <div className="acad-pend">
            <p className="acad-pend-txt">{f.resumen}</p>
            <p className="acad-pend-tag">Ficha en preparación</p>
          </div>
        )}
    </article>
  )
}
