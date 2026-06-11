'use client'

import { useState } from 'react'
import Link from 'next/link'

type ClienteAlerta = {
  client_id: string
  nombre_empresa: string
  estado: string
  fecha_expiracion: string | null
  fecha_fin_gracia: string | null
}

type Tab = 'vencen' | 'trial'

function calcDias(c: ClienteAlerta): { label: string; color: string } {
  const fecha = c.estado === 'GRACIA' ? c.fecha_fin_gracia : c.fecha_expiracion
  if (!fecha) return { label: '—', color: 'var(--color-text-muted)' }
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  const exp = new Date(y, m - 1, d)
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const dias = Math.ceil((exp.getTime() - hoy.getTime()) / 86_400_000)
  if (dias < 0)   return { label: 'Vencido', color: 'var(--color-error)' }
  if (dias === 0) return { label: 'Hoy',     color: 'var(--color-error)' }
  if (dias <= 5)  return { label: `${dias}d`, color: 'var(--color-error)' }
  return              { label: `${dias}d`,    color: 'var(--color-warning)' }
}

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info',
  GRACIA: 'badge-warning', SUSPENDIDO: 'badge-warning', VENCIDO: 'badge-error',
}

function TablaAlerta({ clientes }: { clientes: ClienteAlerta[] }) {
  if (clientes.length === 0) return (
    <div className="pv-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <p>Sin alertas pendientes</p>
    </div>
  )

  return (
    <table className="table pv-table">
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Estado</th>
          <th style={{ textAlign: 'right' }}>Días</th>
        </tr>
      </thead>
      <tbody>
        {clientes.map(c => {
          const { label, color } = calcDias(c)
          return (
            <tr key={c.client_id}>
              <td>
                <Link href={`/admin/clientes/${c.client_id}`} className="table-empresa-link">
                  {c.nombre_empresa}
                </Link>
              </td>
              <td>
                <span className={`badge badge-dot ${ESTADO_BADGE[c.estado] ?? 'badge-neutral'}`}>
                  {c.estado}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <span style={{ fontWeight: 700, fontSize: 'var(--text-xs)', color }}>
                  {label}
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function ProximosVencer({
  vencenPronto,
  trialGracia,
}: {
  vencenPronto: ClienteAlerta[]
  trialGracia:  ClienteAlerta[]
}) {
  const defaultTab: Tab = vencenPronto.length > 0 ? 'vencen' : 'trial'
  const [tab, setTab] = useState<Tab>(defaultTab)

  return (
    <div className="pv-card">
      <div className="pv-header">
        <div className="pv-tabs">
          <button
            className={`pv-tab${tab === 'vencen' ? ' active' : ''}`}
            onClick={() => setTab('vencen')}
          >
            Vencen pronto
            {vencenPronto.length > 0 && (
              <span className="pv-badge">{vencenPronto.length}</span>
            )}
          </button>
          <button
            className={`pv-tab${tab === 'trial' ? ' active' : ''}`}
            onClick={() => setTab('trial')}
          >
            Trial / Gracia
            {trialGracia.length > 0 && (
              <span className="pv-badge">{trialGracia.length}</span>
            )}
          </button>
        </div>
        <Link href="/admin/clientes" className="pv-ver-todos">
          Ver todos →
        </Link>
      </div>

      <div className="pv-body">
        {tab === 'vencen'
          ? <TablaAlerta clientes={vencenPronto} />
          : <TablaAlerta clientes={trialGracia} />
        }
      </div>
    </div>
  )
}
