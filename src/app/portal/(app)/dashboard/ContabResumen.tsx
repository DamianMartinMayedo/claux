'use client'

import { useState } from 'react'
import type { ContabMonedaResumen } from '@/app/actions/portal/dashboard'
import { formatMoneda } from './format'
import VentasGastosChart from './charts/VentasGastosChart'

interface Opcion { key: string; label: string; entry: ContabMonedaResumen }

// Ventas/gastos del mes + gráfica de 6 meses, con un switch dentro del propio
// gráfico para alternar entre el consolidado y cada moneda. Los KPIs siguen al
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
          <span className="dash-kpi-label">Ventas del mes</span>
          <span className="dash-kpi-value dash-kpi-value-sm">{formatMoneda(e.ventasMes, e.moneda)}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Gastos del mes</span>
          <span className="dash-kpi-value dash-kpi-value-sm">{formatMoneda(e.gastosMes, e.moneda)}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Neto del mes</span>
          <span className={`dash-kpi-value dash-kpi-value-sm ${e.netoMes >= 0 ? 'is-pos' : 'is-neg'}`}>{formatMoneda(e.netoMes, e.moneda)}</span>
        </div>
      </div>

      <VentasGastosChart serie={e.serie} moneda={e.moneda} />
    </>
  )
}
