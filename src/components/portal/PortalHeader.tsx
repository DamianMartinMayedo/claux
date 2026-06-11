import type { PortalSession } from '@/lib/portal-auth'

const ESTADO_BADGE: Record<string, { cls: string; label: string }> = {
  ACTIVO:     { cls: 'badge-success', label: 'Activo' },
  TRIAL:      { cls: 'badge-info',    label: 'Trial' },
  GRACIA:     { cls: 'badge-warning', label: 'Gracia' },
  SUSPENDIDO: { cls: 'badge-error',   label: 'Suspendido' },
  VENCIDO:    { cls: 'badge-error',   label: 'Vencido' },
}

interface Props {
  session:       PortalSession
  nombreEmpresa: string
  estado:        string
  planNombre:    string
}

export default function PortalHeader({ session, nombreEmpresa, estado, planNombre }: Props) {
  const estadoBadge = ESTADO_BADGE[estado] ?? { cls: 'badge-neutral', label: estado }
  const inicial     = session.email.charAt(0).toUpperCase()

  return (
    <header className="portal-header">
      <div className="portal-header-left">
        <span className="portal-logo">CLAUX</span>
        <span className="portal-header-empresa">{nombreEmpresa}</span>
      </div>
      <div className="portal-header-right">
        <span className={`badge ${estadoBadge.cls} badge-dot`}>{estadoBadge.label}</span>
        <span className="portal-header-plan">{planNombre}</span>
        <div className="portal-header-user">
          <div className="portal-header-avatar">{inicial}</div>
          <span className="portal-header-email">{session.email}</span>
        </div>
      </div>
    </header>
  )
}
