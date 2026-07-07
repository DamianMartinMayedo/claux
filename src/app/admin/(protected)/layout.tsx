import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isAuthBypassed, DEV_ADMIN, emailEsAdmin } from '@/lib/dev-auth'
import Sidebar from '@/components/admin/Sidebar'
import Header from '@/components/admin/Header'
import { desactivarClientesVencidos } from '@/app/actions/clientes'
import AdminToastWrapper from '@/components/admin/AdminToastWrapper'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user: realUser } } = await supabase.auth.getUser()

  // Lista blanca de admins (defensa en profundidad): una cuenta de Supabase Auth
  // que no esté en ADMIN_EMAILS no entra al panel, aunque exista y esté confirmada.
  if (realUser && !emailEsAdmin(realUser.email)) {
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

  // Bypass de login SOLO en desarrollo local (doble candado en isAuthBypassed):
  // si no hay sesión real, usamos un admin ficticio para pintar el shell.
  const user = realUser ?? (isAuthBypassed() ? DEV_ADMIN : null)
  if (!user) redirect('/admin/login')

  // Desactivar automáticamente clientes con período de gracia vencido o fecha de expiración pasada
  await desactivarClientesVencidos()

  const displayName: string =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.email?.split('@')[0] ?? 'Admin')

  return (
    <div className="admin-shell">
      <Header email={user.email ?? ''} displayName={displayName} />
      <Sidebar />
      <div className="admin-main">
        <AdminToastWrapper>{children}</AdminToastWrapper>
      </div>
    </div>
  )
}
