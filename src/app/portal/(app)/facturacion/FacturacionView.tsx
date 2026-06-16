'use client'

import type { FacturacionData } from '@/app/actions/portal/facturacion'
import { Receipt } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ESTADO_LABEL: Record<string, string> = {
  ACTIVO:     'Activo',
  TRIAL:      'Período de prueba',
  GRACIA:     'Período especial',
  VENCIDO:    'Vencido',
  DESACTIVADO: 'Desactivado',
}

const METODO_LABEL: Record<string, string> = {
  tropipay:      'TropiPay',
  transferencia: 'Transferencia',
  efectivo:      'Efectivo',
}

function fmt(dateStr: string | null | undefined) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function fmtUsd(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function diasRestantes(fechaStr: string | null): number | null {
  if (!fechaStr) return null
  const diff = new Date(fechaStr + 'T23:59:59').getTime() - Date.now()
  return Math.ceil(diff / 86_400_000)
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function FacturacionView({ data }: { data: FacturacionData }) {
  const dias = diasRestantes(data.fecha_expiracion)

  const diasCls =
    dias === null         ? ''                :
    dias <= 0             ? 'fac-dias-venc'   :
    dias <= 7             ? 'fac-dias-warn'   :
                            'fac-dias-ok'

  const diasLabel =
    dias === null ? null :
    dias <= 0     ? 'Expirado' :
    dias === 1    ? '1 día restante' :
                    `${dias} días restantes`

  const estadoCls =
    data.estado === 'ACTIVO'                              ? 'prf-badge-activo'   :
    data.estado === 'TRIAL'                               ? 'prf-badge-trial'    :
    data.estado === 'GRACIA'                              ? 'prf-badge-gracia'   :
    ['VENCIDO', 'DESACTIVADO'].includes(data.estado)       ? 'prf-badge-vencido'  : ''

  return (
    <div className="view-container">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Suscripción</h1>
          <p className="page-subtitle">Estado de tu suscripción e historial de pagos.</p>
        </div>
      </div>

      {/* ── Alerta si vence pronto o ya venció ── */}
      {dias !== null && dias <= 7 && (
        <div className={`alert mb-5 ${dias <= 0 ? 'alert-error' : 'alert-warning'}`}>
          {dias <= 0
            ? 'Tu suscripción ha expirado. Contacta a soporte para renovarla.'
            : `Tu suscripción vence en ${dias} día${dias === 1 ? '' : 's'}. Contacta a soporte para renovarla.`}
        </div>
      )}

      {/* ── Suscripción activa ── */}
      <div className="card mb-5">
        <div className="fac-plan-card">
          <div className="fac-plan-left">
            <div className="fac-plan-title-row">
              <h2 className="fac-plan-name">{data.suscripcion}</h2>
              <span className={`prf-badge ${estadoCls}`}>{ESTADO_LABEL[data.estado] ?? data.estado}</span>
            </div>
            <p className="fac-plan-id">{data.client_id}</p>
          </div>

          <div className="fac-plan-right">
            <div className="fac-expiry-block">
              <span className="fac-expiry-label">Vigente hasta</span>
              <span className="fac-expiry-date">{fmt(data.fecha_expiracion)}</span>
              {diasLabel && (
                <span className={`fac-dias ${diasCls}`}>{diasLabel}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Historial de pagos ── */}
      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">Historial de pagos</h2>
          <span className="text-xs-muted">
            {data.pagos.length} registro{data.pagos.length !== 1 ? 's' : ''}
          </span>
        </div>

        {data.pagos.length === 0 ? (
          <div className="mon-empty">
            <Receipt size={36} strokeWidth={1} opacity={0.25} />
            <p>No hay pagos registrados aún.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Fecha</th>
                  <th>Período</th>
                  <th>Concepto</th>
                  <th className="text-right">Monto</th>
                  <th>Método</th>
                </tr>
              </thead>
              <tbody>
                {data.pagos.map(p => (
                  <tr key={p.pago_id}>
                    <td>
                      <span className="fac-pago-id">{p.pago_id}</span>
                    </td>
                    <td className="text-sm-nowrap">
                      {fmt(p.fecha)}
                    </td>
                    <td>
                      {p.fecha_inicio_periodo && p.fecha_fin_periodo ? (
                        <span className="fac-periodo">
                          {fmt(p.fecha_inicio_periodo)}
                          <span className="fac-periodo-sep">→</span>
                          {fmt(p.fecha_fin_periodo)}
                        </span>
                      ) : (
                        <span className="text-sm-muted">—</span>
                      )}
                    </td>
                    <td className="text-sm-muted">
                      {p.concepto === 'configuracion' ? 'Configuración' : 'Suscripción'}
                    </td>
                    <td className="text-right">
                      <span className="fac-monto">{fmtUsd(p.monto_usd)}</span>
                    </td>
                    <td>
                      <span className="fac-metodo">{METODO_LABEL[p.metodo] ?? p.metodo}</span>
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

