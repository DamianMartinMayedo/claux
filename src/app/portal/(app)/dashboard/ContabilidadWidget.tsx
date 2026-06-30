import Link from 'next/link'
import { Wallet } from 'lucide-react'
import type { ContabilidadResumen } from '@/app/actions/portal/dashboard'
import { formatMoneda, formatFecha } from './format'
import ContabResumen from './ContabResumen'

const ESTADO_FACT: Record<string, { cls: string; label: string }> = {
  BORRADOR: { cls: 'badge-neutral', label: 'Borrador' },
  EMITIDA:  { cls: 'badge-info',    label: 'Emitida' },
  COBRADA:  { cls: 'badge-success', label: 'Cobrada' },
  ANULADA:  { cls: 'badge-error',   label: 'Anulada' },
}

export default function ContabilidadWidget({ data }: { data: ContabilidadResumen }) {
  const caja = data.caja.length
    ? data.caja.map(c => `${c.saldo.toLocaleString('es-ES', { maximumFractionDigits: 0 })} ${c.moneda}`).join(' · ')
    : '—'

  return (
    <section className="card dash-col-full">
      <div className="card-header">
        <div className="dash-card-head">
          <span className="dash-card-icon metric-icon-teal"><Wallet size={18} /></span>
          <h2 className="card-title">Contabilidad</h2>
        </div>
        <Link href="/portal/ventas" className="btn btn-secondary btn-sm">Ver ventas</Link>
      </div>

      <div className="dash-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">Caja</span>
          <span className="dash-kpi-value dash-kpi-value-sm">{caja}</span>
        </div>
      </div>

      <div className="dash-split">
        <div className="dash-split-main">
          <h3 className="dash-subtitle">
            <span>Ventas y gastos · 6 meses</span>
            <Link href="/portal/reportes" className="btn-ghost-xs">Ver reportes</Link>
          </h3>
          <ContabResumen consolidado={data.consolidado} porMoneda={data.porMoneda} />
        </div>
        <div className="dash-split-side">
          <h3 className="dash-subtitle">
            <span>Últimas facturas</span>
            <Link href="/portal/ventas" className="btn-ghost-xs">Ver facturas</Link>
          </h3>
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
                    <span className="dash-list-amount">{formatMoneda(f.total, f.moneda)}</span>
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
