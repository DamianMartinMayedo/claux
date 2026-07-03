'use client'

import { useState, useEffect } from 'react'

const OPCIONES = [10, 20, 50, 100]

/**
 * Paginación en cliente para tablas de listado. Corta el array ya cargado y
 * filtrado; no toca queries ni server actions.
 *
 * - Base 10 registros, cambiable a 20 / 50 / 100 con el selector.
 * - Resetea a la página 1 al cambiar el filtro (varía el total) o el tamaño.
 *
 * Uso:
 *   const { pageItems, ...pag } = usePagination(filtrados)
 *   {pageItems.map(...)}
 *   <TablePagination {...pag} label="factura" />
 */
export function usePagination<T>(items: T[], base = 10) {
  const [porPagina, setPorPagina] = useState(base)
  const [pagina, setPagina] = useState(1)
  const total = items.length
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina))

  useEffect(() => { setPagina(1) }, [total, porPagina])

  const pageItems = items.slice((pagina - 1) * porPagina, pagina * porPagina)
  return { pageItems, pagina, setPagina, totalPaginas, porPagina, setPorPagina, total, base }
}

export function TablePagination({
  pagina,
  totalPaginas,
  setPagina,
  porPagina,
  setPorPagina,
  total,
  base = 10,
  label = 'registro',
}: {
  pagina: number
  totalPaginas: number
  setPagina: (p: number) => void
  porPagina: number
  setPorPagina: (n: number) => void
  total: number
  base?: number
  label?: string
}) {
  // Sin nada que paginar y en tamaño base: no mostrar el pie.
  if (total <= base && porPagina === base) return null

  const plural = total !== 1 ? 's' : ''
  return (
    <div className="pagination">
      <span>{total} {label}{plural} · Página {pagina} de {totalPaginas}</span>
      <div className="pagination-controls">
        <select
          className="filter-select pagination-size"
          value={porPagina}
          onChange={e => setPorPagina(Number(e.target.value))}
          aria-label="Registros por página"
        >
          {OPCIONES.map(n => <option key={n} value={n}>{n} / pág.</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>‹ Ant.</button>
        <button className="btn btn-secondary btn-sm" disabled={pagina >= totalPaginas} onClick={() => setPagina(pagina + 1)}>Sig. ›</button>
      </div>
    </div>
  )
}
