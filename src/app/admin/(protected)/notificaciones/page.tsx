import { requireAccesoPagina } from '@/lib/admin-guard'
import { getSetting } from '@/app/actions/settings'
import NotificacionesForm from './NotificacionesForm'

export default async function NotificacionesPage() {
  await requireAccesoPagina('notificaciones')
  const diasAviso = parseInt(await getSetting('dias_aviso', '5'), 10)

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Notificaciones</h1>
          <p className="page-subtitle">Alertas del sistema y configuración de comunicaciones</p>
        </div>
      </div>

      <div className="page-content-narrow">
        <NotificacionesForm diasAviso={diasAviso} />
      </div>
    </div>
  )
}
