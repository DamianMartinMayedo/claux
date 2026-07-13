import { requireAccesoPagina } from '@/lib/admin-guard'
import { getSetting } from '@/app/actions/settings'
import { listarPlantillas } from '@/app/actions/email-plantillas'
import { TIPOS_EMAIL, type TipoEmail } from '@/lib/email/variables'
import NotificacionesForm from './NotificacionesForm'

export default async function NotificacionesPage() {
  await requireAccesoPagina('notificaciones')

  const [diasAviso, emailAvisosInternos, plantillas, ...toggles] = await Promise.all([
    getSetting('dias_aviso', '5').then(v => parseInt(v, 10)),
    getSetting('email_avisos_internos', 'contacto@claux.es'),
    listarPlantillas(),
    ...TIPOS_EMAIL.map(t => getSetting(`email_on_${t.tipo}`, 'true')),
  ])

  const togglesIniciales = Object.fromEntries(
    TIPOS_EMAIL.map((t, i) => [t.tipo, toggles[i] === 'true']),
  ) as Record<TipoEmail, boolean>

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Notificaciones</h1>
          <p className="page-subtitle">Alertas del sistema y correos automáticos a clientes</p>
        </div>
      </div>

      <NotificacionesForm
        diasAviso={diasAviso}
        emailAvisosInternos={emailAvisosInternos}
        togglesIniciales={togglesIniciales}
        plantillas={plantillas}
      />
    </div>
  )
}
