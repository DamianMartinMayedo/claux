import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import Sidebar from '@/components/admin/Sidebar'
import Header from '@/components/admin/Header'
import { desactivarClientesVencidos } from '@/app/actions/clientes'
import AdminToastWrapper from '@/components/admin/AdminToastWrapper'

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

  // Desactivar automáticamente clientes vencidos (solo super_admin, evita error
  // de permisos para un vendedor al abrir el panel).
  if (ctx.rol === 'super_admin') {
    await desactivarClientesVencidos()
  }

  return (
    <div className="admin-shell">
      <Header displayName={ctx.nombre} rol={ctx.rol} />
      <Sidebar rol={ctx.rol} permisos={ctx.permisos} />
      <div className="admin-main">
        <AdminToastWrapper>{children}</AdminToastWrapper>
      </div>
    </div>
  )
}
