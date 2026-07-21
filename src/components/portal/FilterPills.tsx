'use client'

export interface PillItem {
  id:     string
  label:  string
  color?: string | null   // solo si el elemento tiene color propio (empresas)
}

interface Props {
  items:      PillItem[]
  value:      string                 // '' = todos
  onChange:   (id: string) => void
  todasLabel?: string
  ariaLabel?:  string
  /**
   * Oculta la pastilla «Todos» y obliga a elegir uno. Para cuando la pregunta no es
   * «qué filtro» sino «cuál uso»: la facturación del período emite CON una empresa, y
   * «todas» no significa nada ahí — cada factura pertenece a una.
   */
  sinTodas?:   boolean
  /** Estilo de la custom property de color, cuando los items llevan punto. */
  colorVar?:  (color: string | null | undefined) => React.CSSProperties | undefined
}

// Pastillas de filtro «Todos + una por elemento». Genérico a propósito: lo usan el
// filtro por empresa (con punto de color) y el de punto de venta (sin él). Se oculta
// solo con un elemento o menos: no hay nada que elegir.
export default function FilterPills({
  items, value, onChange, todasLabel = 'Todos', ariaLabel = 'Filtrar', sinTodas, colorVar,
}: Props) {
  if (items.length <= 1) return null

  return (
    <div className="filter-pills" role="group" aria-label={ariaLabel}>
      {!sinTodas && (
        <button
          type="button"
          className={`filter-pill${value === '' ? ' active' : ''}`}
          onClick={() => onChange('')}
          aria-pressed={value === ''}
        >
          {todasLabel}
        </button>
      )}
      {items.map(it => (
        <button
          key={it.id}
          type="button"
          className={`filter-pill${colorVar ? ' filter-pill-dot' : ''}${value === it.id ? ' active' : ''}`}
          style={colorVar?.(it.color)}
          onClick={() => onChange(it.id)}
          aria-pressed={value === it.id}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
