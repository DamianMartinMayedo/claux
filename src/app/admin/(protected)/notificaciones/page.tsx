import { redirect } from 'next/navigation'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import { puedeAcceder, primeraRutaPermitida } from '@/lib/roles'
import { getSetting } from '@/app/actions/settings'
import { listarPlantillas } from '@/app/actions/email-plantillas'
import { listarAvisos, listarPreferenciasAvisos } from '@/app/actions/admin/notificaciones'
import { tiposVisibles } from '@/lib/notificaciones/admin/visibilidad'
import { TIPOS_EMAIL, type TipoEmail } from '@/lib/email/variables'
import NotificacionesForm from './NotificacionesForm'
import BandejaAvisos from './BandejaAvisos'
import PreferenciasAvisos from './PreferenciasAvisos'

// Guard propio en vez de `requireAccesoPagina('notificaciones')`: esta página son
// DOS cosas. La configuración de correos exige el permiso `notificaciones`, pero la
// bandeja la tiene que poder abrir cualquiera que reciba avisos —si no, quien lleva
// soporte pulsa «Ver todos» en la campana y acaba rebotado a otra pantalla—. Se
// entra si tienes una de las dos, y cada mitad se muestra según lo que te toque.
export default async function NotificacionesPage() {
  const ctx = await obtenerContextoAdmin()
  if (!ctx) redirect('/admin/login')

  const puedeCorreos = puedeAcceder(ctx, 'notificaciones')
  const tieneBandeja = tiposVisibles(ctx).length > 0
  if (!puedeCorreos && !tieneBandeja) redirect(primeraRutaPermitida(ctx))

  const esSuperAdmin = ctx.rol === 'super_admin'

  const [diasAviso, emailAvisosInternos, emailContratacion, plantillas, avisos, preferencias, ...toggles] = await Promise.all([
    getSetting('dias_aviso', '5').then(v => parseInt(v, 10)),
    getSetting('email_avisos_internos', 'contacto@claux.es'),
    // Buzón comercial al que escribe el cliente desde el banner del dashboard.
    getSetting('email_contratacion', 'contacto@claux.es'),
    listarPlantillas(),
    listarAvisos('todas', 100),
    // Devuelve [] si no es super_admin; la pestaña tampoco se ofrece.
    listarPreferenciasAvisos(),
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
          <p className="page-subtitle">
            Los avisos que recibe el equipo y los correos automáticos que salen a los clientes
          </p>
        </div>
      </div>

      <NotificacionesForm
        diasAviso={diasAviso}
        emailAvisosInternos={emailAvisosInternos}
        emailContratacion={emailContratacion}
        togglesIniciales={togglesIniciales}
        plantillas={plantillas}
        esSuperAdmin={esSuperAdmin}
        puedeCorreos={puedeCorreos}
        bandeja={<BandejaAvisos inicial={avisos} />}
        preferencias={<PreferenciasAvisos inicial={preferencias} />}
      />
    </div>
  )
}
