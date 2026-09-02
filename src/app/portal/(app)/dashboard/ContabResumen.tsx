'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { ContabMonedaResumen } from '@/app/actions/portal/dashboard'
import { formatMoneda } from './format'

// Recharts pesa ~100 KB gzip y el dashboard es la primera pantalla tras entrar:
// baja en su propio chunk, después de los KPIs, que es lo que se mira primero
// (presupuesto Cuba, CONTEXTO §3). El esqueleto es el mismo que el gráfico ya
// pintaba antes de hidratar, así que la pantalla no cambia.
const VentasGastosChart = dynamic(() => import('./charts/VentasGastosChart'), {
  ssr: false,
  loading: () => <div className="dash-chart dash-chart-skeleton" aria-hidden />,
})

interface Opcion { key: string; label: string; entry: ContabMonedaResumen }

// Ventas/gastos/neto ACUMULADOS de los seis meses que pinta la gráfica, con un
// switch para alternar entre el consolidado y cada moneda. Los KPIs siguen al
// switch. Cliente porque el switch es interactivo.
export default function ContabResumen({
  consolidado,
  porMoneda,
}: {
  consolidado: ContabMonedaResumen | null
  porMoneda:   ContabMonedaResumen[]
}) {
  const opciones: Opcion[] = [
    ...(consolidado ? [{ key: 'consolidado', label: 'Consolidado', entry: consolidado }] : []),
    ...porMoneda.map(pm => ({ key: pm.moneda, label: pm.moneda, entry: pm })),
  ]

  const [sel, setSel] = useState(opciones[0]?.key ?? '')

  if (opciones.length === 0) {
    return <p className="dash-muted">Sin ventas ni gastos en el período.</p>
  }

  const activa = opciones.find(o => o.key === sel) ?? opciones[0]
  const e = activa.entry

  // El acumulado de los SEIS MESES que pinta la gráfica, no el mes en curso. Los
  // KPIs decían «del mes» bajo un rótulo que dice «6 meses», así que el día 1 de
  // cada mes la portada del negocio abría con tres ceros —y con el neto en cero
  // aunque el semestre fuera bueno—. Se lee lo mismo que se ve debajo.
  const ventas = e.serie.reduce((s, m) => s + m.ventas, 0)
  const gastos = e.serie.reduce((s, m) => s + m.gastos, 0)
  const neto   = ventas - gastos

  return (
    <>
      {opciones.length > 1 && (
        <div className="dash-moneda-switch" role="tablist" aria-label="Moneda">
          {opciones.map(o => (
            <button
              key={o.key}
              type="button"
              role="tab"
              aria-selected={o.key === activa.key}
              className={o.key === activa.key ? 'active' : ''}
              onClick={() => setSel(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      <div className="dash-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">Ventas</span>
          <span className="dash-kpi-value dash-kpi-value-sm">{formatMoneda(ventas, e.moneda)}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Gastos</span>
          <span className="dash-kpi-value dash-kpi-value-sm">{formatMoneda(gastos, e.moneda)}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Neto</span>
          <span className={`dash-kpi-value dash-kpi-value-sm ${neto >= 0 ? 'is-pos' : 'is-neg'}`}>{formatMoneda(neto, e.moneda)}</span>
        </div>
      </div>

      <VentasGastosChart serie={e.serie} moneda={e.moneda} />
    </>
  )
}
