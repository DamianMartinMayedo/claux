import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAuthBypassed, DEV_ADMIN } from '@/lib/dev-auth'
import Sidebar from '@/components/admin/Sidebar'
import Header from '@/components/admin/Header'
import { desactivarClientesVencidos } from '@/app/actions/clientes'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user: realUser } } = await supabase.auth.getUser()

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
      <div className="admin-main">{children}</div>
    </div>
  )
}
