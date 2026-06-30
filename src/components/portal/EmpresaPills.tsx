'use client'

import { empresaColorVar } from './EmpresaTag'

interface EmpresaLite {
  empresa_id: string
  nombre:     string
  color?:     string | null
}

interface Props {
  empresas:    EmpresaLite[]
  value:       string                 // '' = todas las empresas
  onChange:    (id: string) => void
  todasLabel?: string
}

// Pastillas de filtro por empresa con su color. Sustituye/acompaña al <select>
// "Todas las empresas" (un <option> nativo no admite color). Se oculta sola
// cuando hay una sola empresa: no hay nada que diferenciar.
export default function EmpresaPills({
  empresas,
  value,
  onChange,
  todasLabel = 'Todas',
}: Props) {
  if (empresas.length <= 1) return null

  return (
    <div className="empresa-pills" role="group" aria-label="Filtrar por empresa">
      <button
        type="button"
        className={`empresa-pill empresa-pill-todas${value === '' ? ' active' : ''}`}
        onClick={() => onChange('')}
        aria-pressed={value === ''}
      >
        {todasLabel}
      </button>
      {empresas.map(e => (
        <button
          key={e.empresa_id}
          type="button"
          className={`empresa-pill${value === e.empresa_id ? ' active' : ''}`}
          style={empresaColorVar(e.color)}
          onClick={() => onChange(e.empresa_id)}
          aria-pressed={value === e.empresa_id}
        >
          {e.nombre}
        </button>
      ))}
    </div>
  )
}
