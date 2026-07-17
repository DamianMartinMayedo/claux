'use client'

// Barras Ventas vs Compras por mes con un tercero. Mismo lenguaje visual que el
// VentasGastosChart del dashboard (barras teal/ámbar, tooltip .dash-tip): las
// compras son el lado saliente, como los gastos allí.
// Las transacciones son eventos discretos, así que van en barras; el gráfico de
// Productos es una LÍNEA porque el precio es un estado que se arrastra.
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { TerceroSerieMes } from '@/app/actions/portal/terceros'

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('es-ES')
}

interface TipPayload { dataKey: string; name: string; value: number }
function ChartTooltip({ active, payload, label, moneda }: {
  active?: boolean; payload?: TipPayload[]; label?: string; moneda: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="dash-tip">
      <div className="dash-tip-title">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="dash-tip-row">
          <span className="dash-tip-dot" data-serie={p.dataKey} />
          {p.name}: <strong>{fmtNum(p.value)} {moneda}</strong>
        </div>
      ))}
    </div>
  )
}

export default function TerceroHistorialChart({
  serie, moneda, hayVentas, hayCompras,
}: {
  serie: TerceroSerieMes[]
  moneda: string
  /** Un cliente puro no tiene compras: dibujar su barra a cero es ruido. */
  hayVentas:  boolean
  hayCompras: boolean
}) {
  return (
    <>
      <div className="dash-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={serie} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} minTickGap={8} />
            <YAxis tickLine={false} axisLine={false} width={52} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickFormatter={fmtNum} />
            <Tooltip cursor={{ fill: 'var(--color-surface-2)', opacity: 0.5 }} content={<ChartTooltip moneda={moneda} />} />
            {hayVentas  && <Bar dataKey="ventas"  name="Ventas"  fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={26} />}
            {hayCompras && <Bar dataKey="compras" name="Compras" fill="var(--color-amber)"   radius={[4, 4, 0, 0]} maxBarSize={26} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="dash-legend">
        {hayVentas  && <span className="dash-legend-item"><span className="dash-tip-dot" data-serie="ventas" /> Ventas</span>}
        {hayCompras && <span className="dash-legend-item"><span className="dash-tip-dot" data-serie="compras" /> Compras</span>}
      </div>
    </>
  )
}
