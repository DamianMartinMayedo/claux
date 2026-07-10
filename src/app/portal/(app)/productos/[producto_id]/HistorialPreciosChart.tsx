'use client'

import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { HistorialPrecio } from '@/app/actions/portal/productos'

// Paleta de colores por moneda (estable entre renders)
const COLORES_MONEDA: Record<string, string> = {
  USD: '#00AFAA', EUR: '#1565C0', CUP: '#6A1B9A',
  MLC: '#C97A0C', GBP: '#AD1457', CAD: '#2E7D32',
}

function colorMoneda(moneda: string, isPrecio: boolean): string {
  const base = COLORES_MONEDA[moneda] ?? '#6366F1'
  return isPrecio ? base : `${base}80` // costo más transparente
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('es-ES')
}

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

interface TooltipPayload { dataKey: string; name: string; value: number; color: string }
function ChartTooltip({ active, payload, label, moneda }: { active?: boolean; payload?: TooltipPayload[]; label?: string; moneda: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="dash-tip">
      <div className="dash-tip-title">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="dash-tip-row">
          <span className="dash-tip-dot" style={{ '--dot': p.color } as React.CSSProperties} />
          {p.name}: <strong>{fmtNum(p.value)} {moneda}</strong>
        </div>
      ))}
    </div>
  )
}

export default function HistorialPreciosChart({ historial, moneda }: { historial: HistorialPrecio[]; moneda: string }) {
  // Filtrar por moneda, ordenar ascendente, rellenar valores nulos (carry forward)
  const data = useMemo(() => {
    const items = historial.filter(h => h.moneda === moneda).sort((a, b) => a.created_at.localeCompare(b.created_at))
    let lastPrecio: number | null = null
    let lastCosto: number | null = null
    return items.map(h => {
      if (h.precio != null) lastPrecio = h.precio
      if (h.costo != null) lastCosto = h.costo
      return {
        fecha: fmtFecha(h.created_at),
        precio: lastPrecio,
        costo: lastCosto,
      }
    })
  }, [historial, moneda])

  if (data.length < 2) return null // necesita al menos 2 puntos para un gráfico

  return (
    <div className="dash-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="fecha" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
          <YAxis tickLine={false} axisLine={false} width={52} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickFormatter={fmtNum} />
          <Tooltip content={<ChartTooltip moneda={moneda} />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
          <Line type="monotone" dataKey="precio" name="Precio" stroke={colorMoneda(moneda, true)} strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="costo" name="Costo" stroke={colorMoneda(moneda, false)} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
