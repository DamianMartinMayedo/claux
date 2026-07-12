import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAuthBypassed, emailEsAdmin } from '@/lib/dev-auth'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user && !emailEsAdmin(user.email)) redirect('/admin/login')
  if (!user && !isAuthBypassed()) redirect('/admin/login')
  redirect('/admin/dashboard')
}
