import { redirect } from 'next/navigation'
import { getPortalSession } from '@/app/actions/portal/auth'
import CambiarPasswordForm from './CambiarPasswordForm'

export const dynamic = 'force-dynamic'

export default async function CambiarPasswordPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')
  return <CambiarPasswordForm email={session.email} />
}
