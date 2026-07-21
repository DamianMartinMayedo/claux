'use client'

import { empresaColorVar } from './EmpresaTag'
import FilterPills from './FilterPills'

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
  /** Sin «Todas»: hay que elegir una (emitir, no filtrar). */
  sinTodas?:   boolean
}

// Filtro por empresa: es `FilterPills` con el punto de color de cada una (un <option>
// nativo no admite color, de ahí las pastillas). La mecánica —«Todas» + una por
// elemento, ocultarse cuando solo hay una— vive en el genérico; aquí queda solo lo
// que es propio de empresas.
export default function EmpresaPills({
  empresas,
  value,
  onChange,
  todasLabel = 'Todas',
  sinTodas,
}: Props) {
  return (
    <FilterPills
      items={empresas.map(e => ({ id: e.empresa_id, label: e.nombre, color: e.color }))}
      value={value}
      onChange={onChange}
      todasLabel={todasLabel}
      sinTodas={sinTodas}
      ariaLabel={sinTodas ? 'Empresa' : 'Filtrar por empresa'}
      colorVar={empresaColorVar}
    />
  )
}
