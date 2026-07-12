import { redirect } from 'next/navigation'
import { getPortalSession, debeCambiarPassword } from '@/app/actions/portal/auth'

export default async function PortalPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')
  if (await debeCambiarPassword(session)) redirect('/portal/cambiar-password')
  redirect('/portal/dashboard')
}
