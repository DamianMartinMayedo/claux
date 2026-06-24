'use client'

// Gráfico de barras Ventas vs Gastos (últimos 6 meses) — tendencia para decidir.
// Recharts en client component; solo se monta tras hidratar (useHydrated) para
// que recharts mida bien el contenedor. Colores vía tokens (var()) → claro/oscuro.
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { SerieMes } from '@/app/actions/portal/dashboard'
import { formatCompacto } from '../format'
import { useHydrated } from './useHydrated'

interface TipPayload { dataKey: string; name: string; value: number }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="dash-tip">
      <div className="dash-tip-title">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="dash-tip-row">
          <span className="dash-tip-dot" data-serie={p.dataKey} />
          {p.name}: <strong>{formatCompacto(p.value)}</strong>
        </div>
      ))}
    </div>
  )
}

export default function VentasGastosChart({ serie }: { serie: SerieMes[] }) {
  if (!useHydrated()) return <div className="dash-chart dash-chart-skeleton" aria-hidden />

  return (
    <>
      <div className="dash-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={serie} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
            <YAxis tickLine={false} axisLine={false} width={52} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickFormatter={formatCompacto} />
            <Tooltip cursor={{ fill: 'var(--color-surface-2)', opacity: 0.5 }} content={<ChartTooltip />} />
            <Bar dataKey="ventas" name="Ventas" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={26} />
            <Bar dataKey="gastos" name="Gastos" fill="var(--color-amber)" radius={[4, 4, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="dash-legend">
        <span className="dash-legend-item"><span className="dash-tip-dot" data-serie="ventas" /> Ventas</span>
        <span className="dash-legend-item"><span className="dash-tip-dot" data-serie="gastos" /> Gastos</span>
      </div>
    </>
  )
}
