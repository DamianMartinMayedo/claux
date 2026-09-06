'use client'

import { CheckCircle } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import Tabs from '@/components/Tabs'
import { diasDeCalendario } from '@/lib/fecha-tz'

type ClienteAlerta = {
  client_id: string
  nombre_empresa: string
  estado: string
  fecha_expiracion: string | null
  fecha_fin_gracia: string | null
}

type Tab = 'vencen' | 'trial'

// `hoy` llega del servidor, en el día del NEGOCIO. Antes salía del reloj del
// navegador (`new Date()`), así que la misma pantalla decía cosas distintas según
// dónde estuviera abierta —y en una lista de a quién hay que cobrar, eso importa.
function calcDias(c: ClienteAlerta, hoy: string): { label: string; tono: string } {
  const fecha = c.estado === 'GRACIA' ? c.fecha_fin_gracia : c.fecha_expiracion
  if (!fecha) return { label: '—', tono: 'dias-value-muted' }
  const dias = diasDeCalendario(hoy, fecha.split('T')[0])
  if (dias < 0)   return { label: 'Vencido', tono: 'dias-value-error' }
  if (dias === 0) return { label: 'Hoy',     tono: 'dias-value-error' }
  if (dias <= 5)  return { label: `${dias}d`, tono: 'dias-value-error' }
  return              { label: `${dias}d`,    tono: 'dias-value-warning' }
}

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'badge-success', TRIAL: 'badge-info',
  GRACIA: 'badge-warning', DESACTIVADO: 'badge-warning', VENCIDO: 'badge-error',
}

function TablaAlerta({ clientes, hoy }: { clientes: ClienteAlerta[]; hoy: string }) {
  if (clientes.length === 0) return (
    <div className="table-empty table-empty-sm">
      <CheckCircle size={36} strokeWidth={1.5} />
      <p>Sin alertas pendientes.</p>
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
          const { label, tono } = calcDias(c, hoy)
          return (
            <tr key={c.client_id}>
              <td data-label="Cliente">
                <Link href={`/admin/clientes/${c.client_id}`} className="table-name-link cell-clamp">
                  {c.nombre_empresa}
                </Link>
              </td>
              <td data-label="Estado">
                <span className={`badge badge-dot ${ESTADO_BADGE[c.estado] ?? 'badge-neutral'}`}>
                  {c.estado}
                </span>
              </td>
              <td data-label="Días" className="col-num">
                <span className={`dias-value ${tono}`}>{label}</span>
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
  hoy,
}: {
  vencenPronto: ClienteAlerta[]
  trialGracia:  ClienteAlerta[]
  /** Día del negocio, calculado en el servidor. */
  hoy: string
}) {
  const defaultTab: Tab = vencenPronto.length > 0 ? 'vencen' : 'trial'
  const [tab, setTab] = useState<Tab>(defaultTab)

  return (
    <div className="pv-card">
      <div className="pv-header">
        <Tabs<Tab>
          ariaLabel="Alertas de vencimiento"
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'vencen', label: 'Vencen pronto',  count: vencenPronto.length > 0 ? vencenPronto.length : undefined },
            { id: 'trial',  label: 'Trial / Gracia', count: trialGracia.length  > 0 ? trialGracia.length  : undefined },
          ]}
        />
        <Link href="/admin/clientes" className="pv-ver-todos">
          Ver todos →
        </Link>
      </div>

      <div className="pv-body">
        {tab === 'vencen'
          ? <TablaAlerta clientes={vencenPronto} hoy={hoy} />
          : <TablaAlerta clientes={trialGracia} hoy={hoy} />
        }
      </div>
    </div>
  )
}
