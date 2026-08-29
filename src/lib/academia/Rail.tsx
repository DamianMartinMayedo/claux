import Link from 'next/link'
import { gruposDe } from './catalogo'
import { rutaDe, BASE_MANUAL } from './piezas'
import type { PiezaLeida } from './manual'

/**
 * Índice lateral del manual: todas las piezas, agrupadas como el catálogo.
 *
 * Lo pinta el servidor en cada pieza, así que la que se está leyendo viene ya
 * marcada por la URL —sin JS y sin parpadeo—. Los apartados solo cuelgan de esa:
 * el índice es una lista de dieciocho piezas, no de trescientos encabezados.
 *
 * `prefetch={false}` a propósito: son dieciocho enlaces a la vista y Next los
 * pediría todos al cargar. Con conexión cubana eso es dieciocho descargas que
 * nadie pidió.
 *
 * Se llama `Rail` y no `Indice` porque `indice.ts` ya es otra cosa —los
 * encabezados de un texto, que es lo que come el buscador— y en macOS dos
 * archivos que solo se distinguen por la mayúscula son el mismo archivo. El
 * nombre además es el que ya usan sus clases (`.acad-rail-*`).
 *
 * `base` es de qué superficie son estos enlaces: el manual (`/academia`) o el
 * centro de ayuda público (`/ayuda`). Es lo ÚNICO que cambia entre las dos, y
 * viaja como prop en vez de duplicar el componente: la lista, los grupos, el
 * plegado y el resaltado son los mismos, y un índice copiado se queda atrás a la
 * primera pieza nueva.
 */

/** Una pieza en el índice, con sus apartados si es la que se está leyendo. */
function Nodo({ pieza, activa, esParte, base }: {
  pieza: PiezaLeida; activa: boolean; esParte?: boolean; base: string
}) {
  return (
    <div className={`acad-rail-node${activa ? ' is-active' : ''}`} data-acad-link={pieza.slug}>
      <Link className={`acad-nav acad-rail-item${esParte ? ' is-part' : ''}`}
            href={rutaDe(pieza.slug, base)} prefetch={false}
            aria-current={activa ? 'page' : undefined}>
        <span className="acad-rail-name">{pieza.nombre}</span>
        {!pieza.cuerpo && <span className="acad-rail-pend">en preparación</span>}
      </Link>
      {activa && pieza.bloques.length > 0 && (
        <div className="acad-rail-sub">
          {pieza.bloques.map(h => (
            <a key={h.id} className="acad-nav acad-rail-sublink" data-acad-sublink={h.id} href={`#${h.id}`}>
              {h.texto}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Rail({
  piezas, actual, base = BASE_MANUAL, publico = false,
}: { piezas: PiezaLeida[]; actual: string; base?: string; publico?: boolean }) {
  const grupos = gruposDe(publico)
  // El catálogo parte el manual en tres: lo que va antes, las fichas y lo que va después.
  const primeraFicha = piezas.findIndex(p => p.ficha)
  const ultimaFicha  = piezas.map(p => !!p.ficha).lastIndexOf(true)
  const antes  = primeraFicha < 0 ? piezas : piezas.slice(0, primeraFicha)
  const fichas = primeraFicha < 0 ? []     : piezas.slice(primeraFicha, ultimaFicha + 1)
  const luego  = primeraFicha < 0 ? []     : piezas.slice(ultimaFicha + 1)

  return (
    <aside className="acad-rail">
      {/* Va abierto de base: si el JS no llega, el manual conserva su índice.
          En móvil lo pliega `AcademiaChrome`, que es quien sabe el ancho. */}
      <details className="acad-rail-det" data-acad-indice open>
        <summary className="acad-rail-sum" aria-label="Índice del manual">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
          <span>Índice del manual</span>
          <svg className="acad-rail-sum-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>

        <nav className="acad-rail-in" aria-label="Índice del manual">
          {antes.length > 0 && (
            <div className="acad-rail-lista">
              {antes.map(p => <Nodo key={p.slug} pieza={p} activa={p.slug === actual} esParte base={base} />)}
            </div>
          )}

          {/* Fuera del equipo no hay «Parte II»: el cliente ve dos de las seis
              partes del manual, así que numerarlas le nombra tomos de un libro
              que no tiene. */}
          <p className="acad-rail-title">
            {publico ? 'Las guías del portal' : 'Parte II — El catálogo'}
          </p>
          {grupos.map(g => {
            const items = fichas.filter(p => p.ficha?.tipo === g.tipo)
            if (items.length === 0) return null
            return (
              /* Cada grupo se pliega por su cuenta: quien vende addons no quiere
                 los cinco módulos ocupando la columna. Abierto de base; el JS
                 solo recuerda lo que se dejó plegado. */
              <details className="acad-rail-group" data-acad-grupo={g.tipo} open key={g.tipo}>
                <summary className="acad-rail-cat">
                  <svg className="acad-rail-cat-chevron" width="12" height="12" viewBox="0 0 24 24"
                       fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                       strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                  <span>{g.titulo}</span>
                  <span className="acad-rail-cat-n">{items.length}</span>
                </summary>
                <div className="acad-rail-lista">
                  {items.map(p => <Nodo key={p.slug} pieza={p} activa={p.slug === actual} base={base} />)}
                </div>
              </details>
            )
          })}

          {luego.length > 0 && (
            <div className="acad-rail-lista">
              {luego.map(p => <Nodo key={p.slug} pieza={p} activa={p.slug === actual} esParte base={base} />)}
            </div>
          )}

          {/* Para buscar con Ctrl+F o leer de una tirada: el manual entero seguido. */}
          <Link className="acad-nav acad-rail-todo" href={`${base}/todo`} prefetch={false}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span>{publico ? 'Todas las guías en una página' : 'El manual entero en una página'}</span>
          </Link>
        </nav>
      </details>
    </aside>
  )
}
