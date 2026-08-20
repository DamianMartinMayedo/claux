'use client'

// ────────────────────────────────────────────────────────────────────────────
// LA BARRA DE FILTROS DEL PORTAL. Una, para todas las pantallas.
//
// Recibe la DECLARACIÓN (`lib/filtros.ts`) y se encarga de todo: pintar cada control, poner
// el valor en la URL, decidir si la consulta la rehace el servidor y enseñar lo que hay
// puesto con su «×».
//
// ── QUÉ RESUELVE ──────────────────────────────────────────────────────────────
// Antes cada vista montaba su barra a mano y salían tres problemas a la vez:
//
//   · **Dos mecánicas con el mismo aspecto.** El rango y la búsqueda vivían en la URL y los
//     demás filtros en `useState`. La misma caja de búsqueda exigía Enter en Gastos y
//     filtraba al teclear en Productos. Nada distinguía una de otra.
//   · **Nada sobrevivía.** Refrescar —o que se caiga la conexión, que en Cuba es el caso
//     normal— tiraba todos los filtros del navegador.
//   · **Sin salida.** Hasta siete controles en dos filas y **ningún «limpiar»** en todo el
//     portal, con un estado vacío que decía «no hay registros para los filtros
//     seleccionados» sin decir cuáles.
//
// ── LO QUE SE VE Y LO QUE SE ESCONDE ──────────────────────────────────────────
// En la fila van el rango, el buscador y los dos primeros filtros (la empresa, casi siempre);
// el resto entra en «Filtros (N)». Con siete controles apilados, la tabla —que es a lo que se
// viene— empezaba a cuatro alturas del principio de la pantalla.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { SlidersHorizontal, X } from 'lucide-react'
import RangoBusqueda from './RangoBusqueda'
import FilterPills from './FilterPills'
import {
  filtrosActivos, paramDe, vaAlServidor, PARAM_ESCALADA,
  type Filtro,
} from '@/lib/filtros'
import { empresaColorVar } from './EmpresaTag'
import type { PresetRango } from '@/lib/listados'

interface Props {
  filtros: Filtro[]
  /** Rango aplicado por el servidor. Omitir en una pantalla sin fechas. */
  rango?: { desde: string; hasta: string }
  /** Búsqueda aplicada. Omitir si la pantalla no busca por texto. */
  q?: string
  placeholder?: string
  presets?: PresetRango[]
  /**
   * El listado está recortado por el techo. Es lo que decide si un filtro `escalado` se
   * aplica en el navegador (instantáneo, y da el mismo resultado porque está todo) o sube al
   * servidor (un viaje, pero es la única forma de que no mienta).
   */
  hayMas?: boolean
  /** Cuántos controles se quedan en la fila visible; el resto, al desplegable. */
  visibles?: number
  /**
   * Se llama con `true` mientras el servidor recarga por un cambio de filtro o de
   * búsqueda, y con `false` al terminar. La lista lo usa para pintar el velo de
   * «cargando» sobre su tabla (`<TablaCargando>`). Combina el pendiente de los
   * filtros y el del buscador/rango.
   */
  onCargando?: (v: boolean) => void
}

export default function Filtros({
  filtros, rango, q, placeholder, presets, hayMas = false, visibles = 2, onCargando,
}: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const ruta   = usePathname()
  const [filtroPend, startTransition] = useTransition()
  const [rangoPend,  setRangoPend]    = useState(false)
  const [abierto, setAbierto] = useState(false)

  // El «cargando» de la tabla es la suma: un cambio de filtro (aquí) o de
  // búsqueda/rango (en `RangoBusqueda`) recarga la misma tabla.
  useEffect(() => { onCargando?.(filtroPend || rangoPend) }, [filtroPend, rangoPend])  // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Hacia dónde se abre el panel.
   *
   * Por defecto hacia la DERECHA. El panel estaba anclado a la derecha del botón, lo que solo
   * vale mientras «Filtros» sea el último control de la fila; en cuanto la barra envuelve y el
   * botón cae al principio de la segunda línea, el panel crece hacia fuera de la pantalla —se
   * veía cortado por detrás del menú lateral—. Se mide al abrir, que es el único momento en
   * que se sabe dónde ha quedado el botón: la fila envuelve según el ancho de la ventana, el
   * número de empresas y la longitud de las etiquetas.
   */
  const anclaRef = useRef<HTMLDivElement>(null)
  const [haciaIzq, setHaciaIzq] = useState(false)

  /** Ancho del panel (`min-width` de `.filtros-panel`) + el margen que se le deja al borde. */
  const ANCHO_PANEL = 15 * 16
  const MARGEN = 16

  function alternar() {
    if (!abierto) {
      const r = anclaRef.current?.getBoundingClientRect()
      setHaciaIzq(!!r && r.left + ANCHO_PANEL > window.innerWidth - MARGEN)
    }
    setAbierto(v => !v)
  }

  const utiles  = filtros.filter(f => !f.implicito && !f.ocultarSi)
  const activos = filtrosActivos(filtros)
  const enFila  = utiles.slice(0, visibles)
  const dentro  = utiles.slice(visibles)

  function navegar(cambios: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null || v === '') next.delete(k)
      else                        next.set(k, v)
    }
    // El techo vuelve al de su filtro: `limite` lo sube «Traer más» y, pegado en la URL,
    // hacía que «Todo» dejara de significar todo.
    next.delete('limite')
    startTransition(() => router.replace(`${ruta}?${next.toString()}`, { scroll: false }))
  }

  /**
   * Cambiar un filtro.
   *
   * Si toca al servidor —porque es de servidor, o porque el listado está truncado y este
   * filtro es `escalado`— se marca la URL para que la página aplique los filtros EN LA
   * CONSULTA. Mientras todo quepa no se marca nada y el filtro es instantáneo: el navegador
   * está mirando el conjunto completo, así que su resultado es el mismo que el del servidor.
   */
  function cambiar(f: Filtro, valor: string) {
    const cambios: Record<string, string | null> = { [paramDe(f)]: valor || null }
    if (vaAlServidor(f, hayMas)) cambios[PARAM_ESCALADA] = '1'
    navegar(cambios)
  }

  /**
   * UN FILTRO QUE LA PANTALLA YA NO OFRECE NO PUEDE SEGUIR FILTRANDO.
   *
   * Los filtros viven en la URL y las pestañas no: cambiar de pestaña deja puesto lo que
   * había, y ahí se abrían dos agujeros, los dos silenciosos:
   *
   *  · **El filtro escondido que sigue filtrando.** En Gastos, «Categoría» se oculta en la
   *    pestaña de Cobros (`ocultarSi`) pero seguía en la URL y la vista lo seguía aplicando:
   *    la lista salía recortada por una categoría que no se veía ni se podía quitar. Y como
   *    `filtroExport` también se salta los ocultos, el fichero NO iba recortado — la pantalla
   *    y la descarga decían cosas distintas de la misma consulta.
   *  · **El valor que ya no existe.** En Ventas los estados de oferta y de factura no se
   *    solapan: filtrar «Aprobada» y saltar a Facturas dejaba una tabla vacía con un chip
   *    que imprimía «APROBADA» en crudo, porque ese valor ya no está entre las opciones.
   *
   * Se limpia solo, aquí, y no en cada `cambiarTab` de cada vista: es la misma invariante
   * para todos los listados y una vista puede cambiar de contexto sin tocar la pestaña
   * (elegir otra empresa deja huérfano al proveedor, que es de UNA empresa).
   *
   * El rango y la búsqueda no entran: no dependen de la pestaña y tirarlos al cambiar de
   * sección sería justo lo que el estado en la URL vino a evitar.
   */
  useEffect(() => {
    const huerfanos: Record<string, string | null> = {}
    for (const f of filtros) {
      // `implicito` es la identidad de la pantalla (el tipo GASTO/COBRO), no un filtro puesto.
      if (f.implicito || !f.valor) continue
      if (f.ocultarSi) { huerfanos[paramDe(f)] = null; continue }
      // Un interruptor no tiene opciones que comprobar; y sin opciones cargadas todavía, no
      // se puede saber si el valor sobra — limpiarlo ahí sería borrarlo mientras carga.
      if (f.widget === 'toggle') continue
      const ops = f.opciones ?? []
      if (ops.length > 0 && !ops.some(o => o.valor === f.valor)) huerfanos[paramDe(f)] = null
    }
    if (Object.keys(huerfanos).length > 0) navegar(huerfanos)
  }, [filtros])   // eslint-disable-line react-hooks/exhaustive-deps

  function limpiar() {
    const cambios: Record<string, string | null> = {}
    for (const f of utiles) cambios[paramDe(f)] = null
    cambios[PARAM_ESCALADA] = null
    navegar(cambios)
  }

  /**
   * ¿Este filtro se pinta como píldoras?
   *
   * Solo si son POCAS. Las píldoras son un atajo —un clic, y el punto de color se lee sin
   * leer— y por eso las merece la empresa, que es el filtro que más cambia lo que ves. Pero
   * con seis empresas vuelven a comerse la fila y dejan de ser un atajo: ahí el desplegable
   * ocupa lo mismo con dos opciones que con veinte.
   */
  /** Nombre corto para el rótulo del panel; sin él, el propio `label`. */
  function rotuloDe(f: Filtro): string {
    return f.rotulo ?? f.label
  }

  const TECHO_PASTILLAS = 4
  function comoPastillas(f: Filtro): boolean {
    return f.widget === 'pastillas' && (f.opciones?.length ?? 0) <= TECHO_PASTILLAS
  }

  function control(f: Filtro) {
    if (f.widget === 'toggle') {
      return (
        <label key={String(f.clave)} className="filtro-toggle">
          <input type="checkbox" className="row-check" checked={f.valor === '1'}
            onChange={e => cambiar(f, e.target.checked ? '1' : '')} />
          {f.label}
        </label>
      )
    }
    if (comoPastillas(f)) {
      return (
        <FilterPills
          key={String(f.clave)}
          items={(f.opciones ?? []).map(o => ({ id: o.valor, label: o.label, color: o.color, count: o.count }))}
          value={f.valor}
          onChange={v => cambiar(f, v)}
          todasLabel={f.label}
          todasCount={f.todasCount}
          /* El nombre accesible sale del `rotulo`, no del `label`: desde que la pastilla de
             «todas» dice «Todas» a secas —el nombre de la empresa lo llevan las de al lado—,
             un grupo anunciado como «Todas» no dice nada de lo que se está filtrando. */
          ariaLabel={rotuloDe(f)}
          colorVar={(f.opciones ?? []).some(o => o.color) ? empresaColorVar : undefined}
        />
      )
    }
    // Los grupos se respetan si los hay: sin ellos, dos proveedores con el mismo nombre en
    // empresas distintas son indistinguibles en la lista.
    const opciones = f.opciones ?? []
    const grupos = opciones.some(o => o.grupo)
      ? [...new Set(opciones.map(o => o.grupo ?? ''))]
      : null
    return (
      <select key={String(f.clave)} className="input ter-filter-select" aria-label={rotuloDe(f)}
        value={f.valor} onChange={e => cambiar(f, e.target.value)}>
        <option value="">{f.label}</option>
        {grupos
          ? grupos.map(g => (
              <optgroup key={g} label={g}>
                {opciones.filter(o => (o.grupo ?? '') === g).map(o => (
                  <option key={o.valor} value={o.valor}>{o.label}</option>
                ))}
              </optgroup>
            ))
          : opciones.map(o => (
              <option key={o.valor} value={o.valor}>{o.label}</option>
            ))}
      </select>
    )
  }

  return (
    <>
      <div className="ter-toolbar">
        {/* Sin `rango` pero con `q` queda solo el buscador: CxC/CxP no llevan fechas a
            propósito —una deuda vieja no puede desaparecer por un filtro que el dueño no ha
            puesto— pero sí buscan por documento o tercero. */}
        {(rango || q !== undefined) && (
          <RangoBusqueda
            desde={rango?.desde ?? ''} hasta={rango?.hasta ?? ''} q={q}
            placeholder={placeholder} presets={rango ? presets : []}
            sinBuscador={q === undefined}
            onPendiente={setRangoPend}
          />
        )}
        {enFila.map(control)}

        {dentro.length > 0 && (
          <div className="filtros-mas" ref={anclaRef}>
            <button type="button" className="btn btn-secondary btn-sm"
              aria-expanded={abierto} onClick={alternar}>
              <SlidersHorizontal size={14} strokeWidth={2} />
              Filtros
              {/* El número en la etiqueta: con los filtros escondidos, saber que hay dos
                  puestos es la diferencia entre entender la tabla y no entenderla. */}
              {activos.filter(a => dentro.some(d => paramDe(d) === a.param)).length > 0 && (
                <span className="filtros-mas-count">
                  {activos.filter(a => dentro.some(d => paramDe(d) === a.param)).length}
                </span>
              )}
            </button>
            {abierto && (
              <>
                <div className="filtros-panel-overlay" onClick={() => setAbierto(false)} />
                <div className={`filtros-panel${haciaIzq ? ' filtros-panel-izq' : ''}`}
                  role="group" aria-label="Más filtros">
                  {/* Cada control con su RÓTULO encima. Sin él el panel es una pila de
                      desplegables cuya única etiqueta es su propia opción «todos» («Todas las
                      categorías», «Todos los proveedores»), y leídos en columna parecen cuatro
                      cosas del mismo tipo. Los interruptores ya llevan su texto al lado. */}
                  {dentro.map(f => f.widget === 'toggle' ? (
                    <div key={String(f.clave)} className="filtros-campo">{control(f)}</div>
                  ) : (
                    <div key={String(f.clave)} className="filtros-campo">
                      <span className="filtros-campo-rotulo">{rotuloDe(f)}</span>
                      {control(f)}
                    </div>
                  ))}
                  {/* «Limpiar» también AQUÍ: es donde acabas de tocar tres filtros, y tenerlo
                      solo en la línea de chips obligaba a cerrar el panel para llegar a él. */}
                  {activos.length > 0 && (
                    <button type="button" className="filtros-panel-limpiar"
                      onClick={() => { limpiar(); setAbierto(false) }}>
                      Limpiar filtros
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Lo que hay puesto, con su «×». Es la misma frase que el menú de descarga anuncia
          («Últimos 3 meses · Empresa 1 · Vencidas»), puesta donde hace falta: encima de la
          tabla que ha cambiado. Y sale de la misma declaración, así que no se pueden
          desincronizar. */}
      {activos.length > 0 && (
        <div className="filtros-chips">
          {activos.map(a => (
            <button key={a.param} type="button" className="filtros-chip"
              onClick={() => navegar({ [a.param]: null })}
              aria-label={`Quitar ${a.label}`}>
              {a.label}
              <X size={12} strokeWidth={2.5} />
            </button>
          ))}
          <button type="button" className="filtros-limpiar" onClick={limpiar}>
            Limpiar
          </button>
        </div>
      )}
    </>
  )
}
