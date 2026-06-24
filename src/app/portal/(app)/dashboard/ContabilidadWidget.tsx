import Link from 'next/link'
import type { ContabilidadResumen } from '@/app/actions/portal/dashboard'
import { formatUSD, formatFecha } from './format'
import VentasGastosChart from './charts/VentasGastosChart'

const ESTADO_FACT: Record<string, { cls: string; label: string }> = {
  BORRADOR:   { cls: 'badge-neutral', label: 'Borrador' },
  CONFIRMADO: { cls: 'badge-success', label: 'Confirmada' },
  ANULADA:    { cls: 'badge-error',   label: 'Anulada' },
}

export default function ContabilidadWidget({ data }: { data: ContabilidadResumen }) {
  const caja = data.caja.length
    ? data.caja.map(c => `${c.saldo.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${c.moneda}`).join(' · ')
    : '—'

  return (
    <section className="card dash-col-full">
      <div className="card-header">
        <h2 className="card-title">Contabilidad</h2>
        <Link href="/portal/ventas" className="btn btn-secondary btn-sm">Ver ventas</Link>
      </div>

      <div className="dash-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">Ventas del mes</span>
          <span className="dash-kpi-value">{formatUSD(data.ventasMes)}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Gastos del mes</span>
          <span className="dash-kpi-value">{formatUSD(data.gastosMes)}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Neto del mes</span>
          <span className={`dash-kpi-value ${data.netoMes >= 0 ? 'is-pos' : 'is-neg'}`}>{formatUSD(data.netoMes)}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Caja</span>
          <span className="dash-kpi-value dash-kpi-value-sm">{caja}</span>
        </div>
      </div>

      <div className="dash-split">
        <div className="dash-split-main">
          <h3 className="dash-subtitle">Ventas y gastos · últimos 6 meses</h3>
          <VentasGastosChart serie={data.serie} />
        </div>
        <div className="dash-split-side">
          <h3 className="dash-subtitle">Últimas facturas</h3>
          {data.ultimasFacturas.length === 0 ? (
            <p className="dash-muted">Aún no hay facturas emitidas.</p>
          ) : (
            <ul className="dash-list">
              {data.ultimasFacturas.map(f => (
                <li key={f.factura_id} className="dash-list-item">
                  <Link href={`/portal/ventas/facturas/${f.factura_id}`} className="dash-list-main">
                    <span className="dash-list-title">{f.numero}</span>
                    <span className="dash-list-meta">{f.cliente_nombre} · {formatFecha(f.fecha)}</span>
                  </Link>
                  <span className="dash-list-aside">
                    <span className="dash-list-amount">{formatUSD(f.total)}</span>
                    <span className={`badge ${ESTADO_FACT[f.estado]?.cls ?? 'badge-neutral'}`}>
                      {ESTADO_FACT[f.estado]?.label ?? f.estado}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
