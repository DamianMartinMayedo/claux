'use client'

import { CheckCircle } from 'lucide-react'
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
  GRACIA: 'badge-warning', DESACTIVADO: 'badge-warning', VENCIDO: 'badge-error',
}

function TablaAlerta({ clientes }: { clientes: ClienteAlerta[] }) {
  if (clientes.length === 0) return (
    <div className="pv-empty">
      <CheckCircle size={32} strokeWidth={1.5} />
      <p>Sin alertas pendientes</p>
    </div>
  )

  return (
    <table className="table pv-table">
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Estado</th>
          <th className="col-num">Días</th>
        </tr>
      </thead>
      <tbody>
        {clientes.map(c => {
          const { label, color } = calcDias(c)
          return (
            <tr key={c.client_id}>
              <td data-label="Cliente">
                <Link href={`/admin/clientes/${c.client_id}`} className="table-empresa-link">
                  {c.nombre_empresa}
                </Link>
              </td>
              <td data-label="Estado">
                <span className={`badge badge-dot ${ESTADO_BADGE[c.estado] ?? 'badge-neutral'}`}>
                  {c.estado}
                </span>
              </td>
              <td data-label="Días" className="col-num">
                <span className="dias-value" style={{ color }}>
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
