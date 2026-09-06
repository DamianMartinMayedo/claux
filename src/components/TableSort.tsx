'use client'

// ── Ordenar una tabla por su columna ─────────────────────────────────────────
//
// Vive junto a `TablePagination` porque se usan siempre en pareja y en este orden:
// se ORDENA la lista filtrada y se PAGINA el resultado. Al revés se ordenaría solo
// la página que se está viendo, que es la trampa clásica de esto.
//
//   const ord = useOrden(filtradas, { nombre: { label: 'Nombre', valor: t => t.nombre } })
//   const { pageItems, ...pag } = usePagination(ord.filas)
//   …
//   <ThOrden orden={ord} clave="nombre">Nombre / ID fiscal</ThOrden>
//
// TRES ESTADOS, no dos: ascendente → descendente → **sin ordenar**. El orden de
// origen lo pone el servidor y significa algo (lo último primero, el cuadre por
// fecha); si ordenar fuese un interruptor de dos posiciones, volver a él exigiría
// recargar la página.
//
// La PRIMERA dirección la decide el TIPO del dato: los textos empiezan por la A y
// los números y las fechas por lo más alto. Quien ordena por importe busca el
// mayor, y quien ordena por nombre busca la letra.
//
// Los VACÍOS van siempre al final, en las dos direcciones: un hueco no es «lo más
// pequeño», es la ausencia del dato, y arrastrarlo arriba al invertir el orden
// esconde justo lo que se estaba mirando.
//
// LAS COLUMNAS NO SE MUEVEN AL ORDENAR. Una `<table>` normal (`table-layout: auto`)
// mide sus columnas con las filas que hay PINTADAS, y en un listado paginado ordenar
// cambia qué filas son: el navegador vuelve a medir y las columnas saltan a izquierda
// y derecha justo cuando la vista está buscando una fila. Por eso, en el clic de la
// cabecera y ANTES de reordenar, se fija el ancho que la tabla tiene en ese momento y
// se pasa a `table-layout: fixed`. Se suelta solo cuando el ancho tiene que volver a
// calcularse de verdad: al cambiar el conjunto de filas (un filtro) o el tamaño de la
// ventana. En móvil no se toca nada: ahí la tabla se pinta como tarjetas.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type Dir = 'asc' | 'desc'
export type ValorOrden = string | number | boolean | Date | null | undefined

export interface ColumnaOrden<T> {
  /** Nombre de la columna para el lector de pantalla y para el `<th>` sin hijos. */
  label: string
  /** El dato por el que se ordena. Devuelve el valor CRUDO (número, fecha, texto),
   *  no el ya formateado: «€1.234,50» se ordena como texto y pone el 9 detrás del 10. */
  valor: (fila: T) => ValorOrden
}

export type ColumnasOrden<T> = Record<string, ColumnaOrden<T>>

export interface Orden<T> {
  filas: T[]
  clave: string | null
  dir: Dir
  columnas: ColumnasOrden<T>
  alternar: (clave: string) => void
  /** Congela los anchos de la tabla que contiene a `desde`. Lo llama `ThOrden`
   *  antes de reordenar; no hace falta usarlo a mano. */
  congelar: (desde: HTMLElement) => void
}

function esVacio(v: ValorOrden): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))
}

function comparar(a: ValorOrden, b: ValorOrden): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (a instanceof Date && b instanceof Date)          return a.getTime() - b.getTime()
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0)
  // `numeric` para que FAC-2 vaya antes que FAC-10, y `base` para que la tilde no
  // mande: en un listado de nombres, «Álvarez» va con las aes.
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' })
}

/** Dirección del primer clic según el tipo del primer dato con valor. */
function dirInicial<T>(col: ColumnaOrden<T>, filas: readonly T[]): Dir {
  for (const f of filas) {
    const v = col.valor(f)
    if (esVacio(v)) continue
    return typeof v === 'string' ? 'asc' : 'desc'
  }
  return 'asc'
}

export function useOrden<T>(
  filas: readonly T[],
  columnas: ColumnasOrden<T>,
  inicial?: { clave: string; dir?: Dir },
): Orden<T> {
  const [estado, setEstado] = useState<{ clave: string; dir: Dir } | null>(
    inicial ? { clave: inicial.clave, dir: inicial.dir ?? 'asc' } : null,
  )

  const ordenadas = useMemo(() => {
    const col = estado ? columnas[estado.clave] : undefined
    // Sin columna (o con una clave que ya no existe) se devuelve el orden de origen.
    if (!estado || !col) return [...filas]
    const signo = estado.dir === 'asc' ? 1 : -1
    // `sort` es estable, así que las filas empatadas conservan el orden del servidor.
    return [...filas].sort((x, y) => {
      const a = col.valor(x)
      const b = col.valor(y)
      const va = esVacio(a)
      const vb = esVacio(b)
      if (va || vb) return va && vb ? 0 : va ? 1 : -1
      return signo * comparar(a, b)
    })
  }, [filas, estado, columnas])

  // La tabla cuyos anchos están congelados (null = ninguna).
  const tablaRef = useRef<HTMLTableElement | null>(null)

  const soltar = useCallback(() => {
    const t = tablaRef.current
    if (!t) return
    tablaRef.current = null
    t.style.tableLayout = ''
    for (const c of Array.from(t.tHead?.rows[0]?.cells ?? [])) c.style.width = ''
  }, [])

  // Cambió el conjunto de filas (un filtro, un alta, un borrado): los anchos de
  // antes ya no describen estos datos, así que se recalculan. Ordenar y pasar de
  // página NO entran aquí: ahí el conjunto es el mismo y las columnas se quedan.
  useEffect(() => { soltar() }, [filas.length, soltar])
  useEffect(() => {
    window.addEventListener('resize', soltar)
    return () => { window.removeEventListener('resize', soltar); soltar() }
  }, [soltar])

  const congelar = useCallback((desde: HTMLElement) => {
    // Por debajo de 640px la tabla es una lista de tarjetas (04-responsive): no
    // hay columnas que fijar, y fijarlas estropearía el ancho de la tarjeta.
    if (!window.matchMedia('(min-width: 641px)').matches) return
    const t = desde.closest('table')
    const fila = t?.tHead?.rows[0]
    // Solo la PRIMERA fila de cabecera: es de la que `table-layout: fixed` toma
    // los anchos. Si el botón vive en una segunda fila, mejor no tocar nada.
    if (!t || !fila || !fila.contains(desde) || tablaRef.current === t) return
    const celdas = Array.from(fila.cells)
    const anchos = celdas.map(c => c.getBoundingClientRect().width)
    if (anchos.some(a => a <= 0)) return
    celdas.forEach((c, i) => { c.style.width = `${anchos[i]}px` })
    t.style.tableLayout = 'fixed'
    tablaRef.current = t
  }, [])

  function alternar(clave: string) {
    setEstado(prev => {
      if (!prev || prev.clave !== clave) {
        const col = columnas[clave]
        return { clave, dir: col ? dirInicial(col, filas) : 'asc' }
      }
      const primera = dirInicial(columnas[clave], filas)
      // Tercer clic: fuera el orden.
      return prev.dir === primera ? { clave, dir: primera === 'asc' ? 'desc' : 'asc' } : null
    })
  }

  return { filas: ordenadas, clave: estado?.clave ?? null, dir: estado?.dir ?? 'asc', columnas, alternar, congelar }
}

/**
 * Cabecera que ordena. Sustituye al `<th>` tal cual, con las mismas clases de
 * columna (`col-num`, `col-center`…).
 *
 * Es un `<button>` de verdad dentro del `<th>`, no un `onClick` en la celda: se
 * llega con el tabulador y se dispara con Enter. El `aria-sort` va en el `<th>`,
 * que es lo que lee el lector de pantalla.
 */
export function ThOrden<T>({
  orden, clave, className, title, children,
}: {
  orden: Orden<T>
  clave: string
  className?: string
  /** Aclaración de la columna; va en el botón, que es lo que se apunta con el ratón. */
  title?: string
  children?: React.ReactNode
}) {
  const col = orden.columnas[clave]
  const activo = orden.clave === clave
  const dir = activo ? orden.dir : null
  return (
    <th
      className={`th-sort${activo ? ' th-sort-activo' : ''}${className ? ` ${className}` : ''}`}
      aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className="th-sort-btn"
        onClick={e => { orden.congelar(e.currentTarget); orden.alternar(clave) }}
        title={title} aria-label={`Ordenar por ${col?.label ?? clave}`}>
        <span>{children ?? col?.label}</span>
        <svg className="th-sort-ind" width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true">
          {dir === 'asc'  && <polyline points="18 15 12 9 6 15" />}
          {dir === 'desc' && <polyline points="6 9 12 15 18 9" />}
          {!dir && <><polyline points="17 11 12 6 7 11" /><polyline points="7 13 12 18 17 13" /></>}
        </svg>
      </button>
    </th>
  )
}
