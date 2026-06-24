'use client'

// Gráfico de carga de los próximos 7 días (reservas o citas por día) — ayuda a
// ver días punta y planificar. Recharts client-only tras hidratar.
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useHydrated } from './useHydrated'

interface Punto { fecha: string; etiqueta: string; total: number }
interface TipPayload { value: number; name: string }

// La unidad (reserva/cita) llega como `name` de la barra → tooltip a nivel módulo.
function CargaTooltip({ active, payload, label }: { active?: boolean; payload?: TipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  const n = payload[0].value
  const unidad = payload[0].name
  return (
    <div className="dash-tip">
      <div className="dash-tip-title">{label}</div>
      <div className="dash-tip-row">{n} {unidad}{n !== 1 ? 's' : ''}</div>
    </div>
  )
}

export default function CargaSemanalChart({ serie, unidad }: { serie: Punto[]; unidad: string }) {
  if (!useHydrated()) return <div className="dash-chart dash-chart-skeleton" aria-hidden />

  return (
    <div className="dash-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={serie} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
          <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
          <Tooltip cursor={{ fill: 'var(--color-surface-2)', opacity: 0.5 }} content={<CargaTooltip />} />
          <Bar dataKey="total" name={unidad} fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={34} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
