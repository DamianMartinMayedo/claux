import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import { esExterno, RUTA_MANUAL } from '@/lib/roles'
import TopLoader from '@/components/portal/TopLoader'
import Sidebar from '@/components/admin/Sidebar'
import Header from '@/components/admin/Header'
import { desactivarClientesVencidos } from '@/app/actions/clientes'
import AdminToastWrapper from '@/components/admin/AdminToastWrapper'
import { AvisosProvider } from '@/components/admin/notificaciones/AvisosContext'
import AvisosPopups from '@/components/admin/notificaciones/AvisosPopups'
import { cargarAvisosIniciales } from '@/app/actions/admin/notificaciones'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user: realUser } } = await supabase.auth.getUser()
  const ctx = await obtenerContextoAdmin()

  // Cuenta de Supabase Auth existente pero SIN autorización (ni whitelist ni fila
  // activa en admin_users) → pantalla de acceso denegado (defensa en profundidad).
  if (realUser && !ctx) {
    return (
      <div className="login-container">
        <div className="login-box">
          <div className="card card-lg">
            <h1 className="login-card-title">Acceso no autorizado</h1>
            <p className="text-sm-muted mb-4">
              Esta cuenta no tiene permisos de administrador. Si crees que es un error,
              contacta con el equipo de CLAUX.
            </p>
            <Link href="/" className="btn btn-secondary btn-full">Volver al inicio</Link>
          </div>
        </div>
      </div>
    )
  }

  // Sin sesión (y sin bypass de desarrollo) → login.
  if (!ctx) redirect('/admin/login')

  // Un PARTNER es de fuera de CLAUX: comparte tabla de cuentas y login con el
  // equipo, pero el panel no es suyo. Se corta aquí, en la raíz de todo lo
  // protegido, y no página a página: así una sección nueva nace cerrada para él
  // sin que nadie tenga que acordarse. Su sitio es el manual.
  if (esExterno(ctx.rol)) redirect(RUTA_MANUAL)

  // Desactivar automáticamente clientes vencidos (solo super_admin, evita error
  // de permisos para un vendedor al abrir el panel).
  if (ctx.rol === 'super_admin') {
    await desactivarClientesVencidos()
  }

  // Carga inicial de la bandeja del equipo: la campana nace con su contador puesto
  // y los popups pueden salir en la primera pantalla, sin una ida y vuelta extra.
  // Ya viene filtrada por los permisos de quien está en sesión.
  const avisosIniciales = await cargarAvisosIniciales()

  return (
    <AvisosProvider inicial={avisosIniciales}>
      <div className="admin-shell">
        <TopLoader />
        <Header displayName={ctx.nombre} rol={ctx.rol} />
        <Sidebar rol={ctx.rol} permisos={ctx.permisos} />
        <div className="admin-main">
          <AdminToastWrapper>{children}</AdminToastWrapper>
        </div>
        <AvisosPopups />
      </div>
    </AvisosProvider>
  )
}
