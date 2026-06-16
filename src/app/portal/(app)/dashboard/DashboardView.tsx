'use client'

import { DollarSign, File, Tag, TrendingDown, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import type { DashboardResumen } from '@/app/actions/portal/dashboard'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info', GRACIA: 'badge-warning',
  DESACTIVADO: 'badge-error', VENCIDO: 'badge-error',
}

const ESTADO_FACTURA_BADGE: Record<string, { cls: string; label: string }> = {
  BORRADOR:    { cls: 'badge-neutral', label: 'Borrador' },
  CONFIRMADO:  { cls: 'badge-success', label: 'Confirmada' },
  ANULADA:     { cls: 'badge-error',   label: 'Anulada' },
}

function formatFecha(fecha: string) {
  if (!fecha) return '—'
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(y).slice(-2)}`
}

function formatUSD(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

interface Props {
  data: DashboardResumen
  // FASE 2 — modulosActivos: string[] (para métricas condicionales)
}

export default function DashboardView({ data }: Props) {
  const { ventasMes, gastosMes, balance, suscripcion, ultimasFacturas, empresas } = data
  const neto = ventasMes.total_usd - gastosMes.total_usd

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Resumen general de tu negocio.</p>
        </div>
      </div>

      {/* ── Métricas ── */}
      <div className="metrics-grid">
        {/* Ventas del mes */}
        <div className="metric-card">
          <div className="metric-icon metric-icon-success">
            <TrendingUp size={20} />
          </div>
          <div className="metric-label">Ventas del mes</div>
          <div className="metric-value">{formatUSD(ventasMes.total_usd)}</div>
          <div className="metric-sub">{ventasMes.cantidad} factura{ventasMes.cantidad !== 1 ? 's' : ''}</div>
        </div>

        {/* Gastos del mes */}
        <div className="metric-card">
          <div className="metric-icon metric-icon-danger">
            <TrendingDown size={20} />
          </div>
          <div className="metric-label">Gastos del mes</div>
          <div className="metric-value">{formatUSD(gastosMes.total_usd)}</div>
          <div className="metric-sub">{gastosMes.cantidad} registro{gastosMes.cantidad !== 1 ? 's' : ''}</div>
        </div>

        {/* Balance */}
        <div className="metric-card">
          <div className={`metric-icon ${neto >= 0 ? 'metric-icon-success' : 'metric-icon-danger'}`}>
            <DollarSign size={20} />
          </div>
          <div className="metric-label">Balance</div>
          <div className="metric-value">{formatUSD(neto)}</div>
          <div className="metric-sub">
            {balance.length > 0
              ? balance.map(b => `${b.saldo.toFixed(0)} ${b.moneda}`).join(' · ')
              : `${empresas} empresa${empresas !== 1 ? 's' : ''}`}
          </div>
        </div>

        {/* Suscripción */}
        <div className="metric-card">
          <div className={`metric-icon ${suscripcion.estado === 'ACTIVO' ? 'metric-icon-success' : suscripcion.estado === 'TRIAL' ? 'metric-icon-teal' : 'metric-icon-warning'}`}>
            <Tag size={20} />
          </div>
          <div className="metric-label">Suscripción</div>
          <div className="metric-value" style={{ fontSize: 'var(--text-xl)' }}>
            <span className={`badge badge-dot ${ESTADO_BADGE[suscripcion.estado] ?? 'badge-neutral'}`}>
              {suscripcion.estado}
            </span>
          </div>
          <div className="metric-sub">
            {suscripcion.diasRestantes !== null && suscripcion.diasRestantes >= 0
              ? `${suscripcion.diasRestantes} día${suscripcion.diasRestantes !== 1 ? 's' : ''} restantes`
              : suscripcion.diasRestantes !== null
                ? 'Vencido'
                : suscripcion.label}
          </div>
        </div>

        {/* FASE 2 — Métricas condicionales (ejemplo comentado):
        {false && (
          <div className="metric-card">
            <div className="metric-icon metric-icon-primary">
              <IconIA />
            </div>
            <div className="metric-label">Insights IA</div>
            <div className="metric-value">3</div>
            <div className="metric-sub">Recomendaciones pendientes</div>
          </div>
        )}
        */}
      </div>

      {/* ── Últimas facturas ── */}
      <div className="card card-table">
        <div className="card-header">
          <h2 className="card-title">Últimas facturas</h2>
          <Link href="/portal/ventas" className="btn btn-secondary btn-sm">
            Ver todas
          </Link>
        </div>

        {ultimasFacturas.length === 0 ? (
          <div className="table-empty table-empty-sm">
            <File size={36} strokeWidth={1.5} />
            <p>Aún no hay facturas emitidas este mes.</p>
          </div>
        ) : (
          <div className="table-wrapper table-wrapper-flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Cliente</th>
                  <th>Fecha</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {ultimasFacturas.map(f => (
                  <tr key={f.factura_id}>
                    <td>
                      <Link
                        href={`/portal/ventas/facturas/${f.factura_id}`}
                        className="table-empresa-link"
                      >
                        {f.numero}
                      </Link>
                    </td>
                    <td>{f.cliente_nombre}</td>
                    <td className="table-muted">{formatFecha(f.fecha)}</td>
                    <td className="table-price" style={{ textAlign: 'right' }}>
                      {formatUSD(f.total)}
                    </td>
                    <td>
                      <span className={`badge ${ESTADO_FACTURA_BADGE[f.estado]?.cls ?? 'badge-neutral'}`}>
                        {ESTADO_FACTURA_BADGE[f.estado]?.label ?? f.estado}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
