import { redirect } from 'next/navigation'
import { isAuthBypassed } from '@/lib/dev-auth'

export default function Home() {
  // Con el bypass de desarrollo, saltar el login y entrar directo al dashboard.
  redirect(isAuthBypassed() ? '/admin/dashboard' : '/admin/login')
}
