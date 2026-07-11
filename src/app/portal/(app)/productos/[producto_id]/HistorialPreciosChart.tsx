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
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

function fmtHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

// Tooltip: fecha + hora para desambiguar varios cambios el mismo día.
function fmtFechaHora(iso: string): string {
  return `${fmtFecha(iso)}, ${fmtHora(iso)}`
}

function diaDe(iso: string): string {
  return iso.slice(0, 10) // YYYY-MM-DD
}

interface TooltipPayload { dataKey: string; name: string; value: number; color: string }
function ChartTooltip({ active, payload, label, moneda }: { active?: boolean; payload?: TooltipPayload[]; label?: string; moneda: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="dash-tip">
      <div className="dash-tip-title">{label ? fmtFechaHora(label) : ''}</div>
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
  // Filtrar por moneda, ordenar ascendente, rellenar valores nulos (carry forward).
  // La clave del eje X es el timestamp COMPLETO (`ts`), no la fecha formateada: si
  // varios cambios ocurren el mismo día compartirían etiqueta y recharts los
  // colapsaría (mismos datos en cada punto). Con `ts` único cada punto es distinto.
  const data = useMemo(() => {
    const items = historial.filter(h => h.moneda === moneda).sort((a, b) => a.created_at.localeCompare(b.created_at))
    let lastPrecio: number | null = null
    let lastCosto: number | null = null
    return items.map(h => {
      if (h.precio != null) lastPrecio = h.precio
      if (h.costo != null) lastCosto = h.costo
      return {
        ts: h.created_at,
        precio: lastPrecio,
        costo: lastCosto,
      }
    })
  }, [historial, moneda])

  if (data.length < 2) return null // necesita al menos 2 puntos para un gráfico

  // Si todos los cambios son del mismo día, los ticks muestran la HORA (los días
  // repetidos no aportan); si abarcan varios días, muestran la fecha.
  const mismoDia = data.every(d => diaDe(d.ts) === diaDe(data[0].ts))
  const tickFmt = mismoDia ? fmtHora : fmtFecha

  return (
    <div className="dash-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="ts" tickFormatter={tickFmt} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} minTickGap={16} />
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
