import { redirect } from 'next/navigation'
import { getPortalSession, accesoModulosSession } from '@/app/actions/portal/auth'
import { listarNotificaciones, listarPreferencias } from '@/app/actions/portal/notificaciones'
import { categoriasBandeja, type Categoria } from '@/lib/notificaciones/catalogo'
import NotificacionesView from './NotificacionesView'

export const dynamic = 'force-dynamic'

// Centro de notificaciones internas. No se gatea por módulo (no se contrata: es
// plataforma) sino por ROL: el admin ve la bandeja entera y las preferencias del
// negocio; un `usuario` ve solo lo operativo de sus módulos (decisión 4) y NO las
// preferencias. Cada aviso ya nació filtrado por los módulos contratados.
export default async function NotificacionesPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const esAdmin = session.rol === 'admin_empresa'

  // Categorías que este rol ve en la bandeja: `null` = todas (admin). Un usuario
  // sin ninguna categoría operativa no tiene bandeja: fuera (evita además que
  // <NotificacionesView> reviente pidiendo un provider que no se montó).
  let categorias: Categoria[] | null = null
  if (!esAdmin) {
    const acceso = await accesoModulosSession(session)
    const cats = categoriasBandeja(session.rol, acceso.visibles)
    if (!cats || cats.length === 0) redirect('/portal/dashboard')
    categorias = cats
  }

  const [notificaciones, preferencias] = await Promise.all([
    listarNotificaciones('todas', 100),
    esAdmin ? listarPreferencias() : Promise.resolve([]),
  ])

  return (
    <NotificacionesView
      inicial={notificaciones}
      preferencias={preferencias}
      esAdmin={esAdmin}
      categorias={categorias}
    />
  )
}
