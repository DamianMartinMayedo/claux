import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/admin/Sidebar'
import Header from '@/components/admin/Header'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

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
