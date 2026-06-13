import type { PortalSession } from '@/lib/portal-auth'
import { ESTADO_BADGE, ESTADO_LABEL } from '@/lib/badges'

interface Props {
  session:       PortalSession
  nombreEmpresa: string
  estado:        string
  planNombre:    string
}

export default function PortalHeader({ session, nombreEmpresa, estado, planNombre }: Props) {
  const estadoCls   = ESTADO_BADGE[estado]   ?? 'badge-neutral'
  const estadoLabel = ESTADO_LABEL[estado]   ?? estado
  const inicial     = session.email.charAt(0).toUpperCase()

  return (
    <header className="portal-header">
      <div className="portal-header-left">
        <span className="portal-logo">CLAUX</span>
        <span className="portal-header-empresa">{nombreEmpresa}</span>
      </div>
      <div className="portal-header-right">
        <span className={`badge ${estadoCls} badge-dot`}>{estadoLabel}</span>
        <span className="portal-header-plan">{planNombre}</span>
        <div className="portal-header-user">
          <div className="portal-header-avatar">{inicial}</div>
          <span className="portal-header-email">{session.email}</span>
        </div>
      </div>
    </header>
  )
}
