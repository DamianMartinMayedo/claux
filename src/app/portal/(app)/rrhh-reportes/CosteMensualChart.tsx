'use client'

// Coste de personal por mes. Vive aparte de ReportesView para que recharts
// (~100 KB gzip) baje en su propio chunk y solo cuando hay gráfico que pintar:
// con varias monedas en juego no se dibuja, y entonces tampoco se descarga.
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

interface Punto { mes: string; coste: number }

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function CosteMensualChart({ serie, moneda }: { serie: Punto[]; moneda: string }) {
  return (
    <div className="dash-chart">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="mes" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} width={56} />
          <Tooltip formatter={(v) => `${formatMonto(Number(v ?? 0))} ${moneda}`}
            contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="coste" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
