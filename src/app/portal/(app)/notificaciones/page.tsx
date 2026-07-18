import { redirect } from 'next/navigation'
import { getPortalSession } from '@/app/actions/portal/auth'
import { listarNotificaciones, listarPreferencias } from '@/app/actions/portal/notificaciones'
import NotificacionesView from './NotificacionesView'

export const dynamic = 'force-dynamic'

// Centro de notificaciones internas. No se gatea por módulo (no se contrata: es
// plataforma) sino por ROL: la bandeja es compartida del negocio y solo la ven
// sus administradores. Cada aviso ya nació filtrado por los módulos contratados.
export default async function NotificacionesPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')
  if (session.rol !== 'admin_empresa') redirect('/portal/dashboard')

  const [notificaciones, preferencias] = await Promise.all([
    listarNotificaciones('todas', 100),
    listarPreferencias(),
  ])

  return <NotificacionesView inicial={notificaciones} preferencias={preferencias} />
}
