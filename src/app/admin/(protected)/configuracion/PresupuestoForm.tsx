'use client'

// ── Los precios del presupuesto de instalación ──
//
// Estaban quemados en `src/lib/presupuesto/config.ts`: cambiar el precio de una hora exigía
// tocar código y desplegar. Y no había forma de que el volumen moviera el precio, así que
// declarar 20 productos o 5.000 costaba lo mismo.
//
// Cada línea se describe con cuatro números y el coste escala solo:
//   horas = horas_base + ceil(max(0, volumen − incluido) / tramo) × horas_por_tramo

import { useState } from 'react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarParametrosPresupuesto } from '@/app/actions/presupuesto-parametros'
import { AJUSTES_PRESUPUESTO, type LineaParametro } from '@/lib/presupuesto/config'

type Escalares = Record<string, string>
type LineaEdit = Pick<LineaParametro, 'clave' | 'etiqueta' | 'fase' | 'horas_base' | 'incluido' | 'tramo' | 'horas_por_tramo'>

const CLAVES = Object.keys(AJUSTES_PRESUPUESTO) as (keyof typeof AJUSTES_PRESUPUESTO)[]

export default function PresupuestoForm({
  escalares: escalaresIniciales,
  lineas: lineasIniciales,
}: {
  escalares: Record<string, number>
  lineas: LineaEdit[]
}) {
  const [escalares, setEscalares] = useState<Escalares>(
    Object.fromEntries(CLAVES.map(k => [k, String(escalaresIniciales[k] ?? 0)])),
  )
  const [lineas, setLineas] = useState<LineaEdit[]>(lineasIniciales)
  const [loading, setLoading] = useState(false)

  function setLinea(clave: string, campo: keyof LineaEdit, valor: string) {
    setLineas(prev => prev.map(l => l.clave === clave ? { ...l, [campo]: Number(valor) || 0 } : l))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await guardarParametrosPresupuesto({
      escalares: Object.fromEntries(CLAVES.map(k => [k, Number(escalares[k]) || 0])),
      lineas: lineas.map(({ clave, horas_base, incluido, tramo, horas_por_tramo }) =>
        ({ clave, horas_base, incluido, tramo, horas_por_tramo })),
    })
    setLoading(false)
    if (!res.ok) { toastError(res.error ?? 'No se pudieron guardar los precios.'); return }
    toastSuccess('Precios del presupuesto guardados')
  }

  const porFase = (fase: 1 | 2) => lineas.filter(l => l.fase === fase)

  return (
    <form onSubmit={handleSubmit} className="config-form">
      <div className="input-group">
        <label htmlFor="pp-tarifa">{AJUSTES_PRESUPUESTO.tarifaHora.label}</label>
        <input id="pp-tarifa" type="number" min="0" step="any" className="input"
          value={escalares.tarifaHora} onChange={e => setEscalares(p => ({ ...p, tarifaHora: e.target.value }))} />
        <span className="input-hint">
          Tarifa base de toda la instalación. En cada presupuesto se puede pactar otra para ese cliente.
        </span>
      </div>

      <div className="grid-cols-2">
        {CLAVES.filter(k => k !== 'tarifaHora').map(k => (
          <div key={k} className="input-group">
            <label htmlFor={`pp-${k}`}>{AJUSTES_PRESUPUESTO[k].label}</label>
            <input id={`pp-${k}`} type="number" min="0" step="any" className="input"
              value={escalares[k]} onChange={e => setEscalares(p => ({ ...p, [k]: e.target.value }))} />
          </div>
        ))}
      </div>

      {([1, 2] as const).map(fase => (
        <div key={fase} className="pp-bloque">
          <p className="mod-list-label">
            {fase === 1 ? 'Configuración inicial' : 'Migración de datos'}
          </p>
          <div className="table-wrapper">
            <table className="table pp-tabla">
              <thead>
                <tr>
                  <th>Línea</th>
                  <th className="col-num">Horas base</th>
                  <th className="col-num">Incluye hasta</th>
                  <th className="col-num">Tramo</th>
                  <th className="col-num">Horas/tramo</th>
                </tr>
              </thead>
              <tbody>
                {porFase(fase).map(l => (
                  <tr key={l.clave}>
                    <td data-label="Línea"><span className="cell-clamp">{l.etiqueta}</span></td>
                    <td data-label="Horas base" className="col-num">
                      <input type="number" min="0" step="0.25" className="input pp-num"
                        aria-label={`Horas base de ${l.etiqueta}`}
                        value={l.horas_base} onChange={e => setLinea(l.clave, 'horas_base', e.target.value)} />
                    </td>
                    <td data-label="Incluye hasta" className="col-num">
                      <input type="number" min="0" step="1" className="input pp-num"
                        aria-label={`Volumen incluido de ${l.etiqueta}`}
                        value={l.incluido} onChange={e => setLinea(l.clave, 'incluido', e.target.value)} />
                    </td>
                    <td data-label="Tramo" className="col-num">
                      <input type="number" min="1" step="1" className="input pp-num"
                        aria-label={`Tamaño de tramo de ${l.etiqueta}`}
                        value={l.tramo} onChange={e => setLinea(l.clave, 'tramo', e.target.value)} />
                    </td>
                    <td data-label="Horas/tramo" className="col-num">
                      <input type="number" min="0" step="0.25" className="input pp-num"
                        aria-label={`Horas por tramo de ${l.etiqueta}`}
                        value={l.horas_por_tramo} onChange={e => setLinea(l.clave, 'horas_por_tramo', e.target.value)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <p className="input-hint">
        Una línea cuesta sus <strong>horas base</strong> hasta el volumen que <strong>incluye</strong>,
        y a partir de ahí suma <strong>horas/tramo</strong> por cada <strong>tramo</strong> empezado.
        Pasarse por uno cuesta el tramo entero, que es como se factura el trabajo.
      </p>

      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar precios'}
      </button>
    </form>
  )
}
