'use client'

// ────────────────────────────────────────────────────────────────────────────
// Rango de fechas + buscador de un listado, con el estado EN LA URL.
//
// Los cuatro listados de Contabilidad comparten este control (Ventas, Gastos y cobros,
// Tesorería y CxC/CxP), y el vocabulario de los presets es el mismo que el de Reportes:
// «Este mes» significa lo mismo en las dos pantallas, o el dueño deja de confiar en las
// dos.
//
// El estado vive en la URL y no en `useState` porque el filtro se aplica EN EL SERVIDOR:
// cambiarlo es navegar. De paso, volver del detalle de un documento —o refrescar en una
// conexión que se cae— no pierde lo que estabas mirando.
// ────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { PRESETS_RANGO, fechasDePreset, presetDeFechas, type PresetRango } from '@/lib/listados'

interface Props {
  /** Rango realmente aplicado por el servidor (no lo que pide la URL). */
  desde: string
  hasta: string
  q:     string
  /** Placeholder del buscador: cada listado busca por cosas distintas. */
  placeholder?: string
  /** Presets a ofrecer. CxC/CxP no ofrece rango: pasa `[]` y solo queda el buscador. */
  presets?: PresetRango[]
}

export default function RangoBusqueda({
  desde, hasta, q, placeholder = 'Buscar…', presets,
}: Props) {
  const router  = useRouter()
  const params  = useSearchParams()
  const ruta    = usePathname()
  const [texto, setTexto] = useState(q)
  const [abierto, setAbierto] = useState(false)

  const activo = presetDeFechas(desde, hasta)
  const lista  = presets ? PRESETS_RANGO.filter(p => presets.includes(p.id)) : PRESETS_RANGO

  function navegar(cambios: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) next.delete(k)
      else            next.set(k, v)
    }
    router.replace(`${ruta}?${next.toString()}`, { scroll: false })
  }

  function elegirPreset(p: PresetRango) {
    const f = fechasDePreset(p)
    setAbierto(p === 'personalizado')
    // «Todo» se escribe como cadena vacía, no borrando el parámetro: el servidor
    // distingue «sin rango» (vacío) de «no me has dicho nada» (ausente → 3 meses).
    navegar({ desde: f.desde, hasta: f.hasta })
  }

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    navegar({ q: texto.trim() || null })
  }

  return (
    <div className="rango-busqueda">
      {lista.length > 0 && (
        <div className="rango-presets" role="group" aria-label="Rango de fechas">
          {lista.map(p => (
            <button
              key={p.id}
              type="button"
              className={`rango-pill${activo === p.id ? ' active' : ''}`}
              onClick={() => elegirPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className={`rango-pill${activo === 'personalizado' || abierto ? ' active' : ''}`}
            onClick={() => setAbierto(v => !v)}
            aria-expanded={abierto || activo === 'personalizado'}
          >
            Personalizado
          </button>
        </div>
      )}

      {(abierto || activo === 'personalizado') && lista.length > 0 && (
        <div className="rango-fechas">
          <label htmlFor="rango-desde">Desde</label>
          <input
            id="rango-desde" className="input input-sm" type="date" value={desde}
            max={hasta || undefined}
            onChange={e => navegar({ desde: e.target.value })}
          />
          <label htmlFor="rango-hasta">Hasta</label>
          <input
            id="rango-hasta" className="input input-sm" type="date" value={hasta}
            min={desde || undefined}
            onChange={e => navegar({ hasta: e.target.value })}
          />
        </div>
      )}

      <form className="ter-search-wrap" onSubmit={buscar}>
        <Search size={14} strokeWidth={2} />
        <input
          className="ter-search"
          type="search"
          value={texto}
          aria-label={placeholder}
          placeholder={placeholder}
          onChange={e => setTexto(e.target.value)}
        />
        {q && (
          <button
            type="button"
            className="rango-limpiar"
            onClick={() => { setTexto(''); navegar({ q: null }) }}
            aria-label="Quitar la búsqueda"
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        )}
      </form>
    </div>
  )
}
