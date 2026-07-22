import { redirect }               from 'next/navigation'
import { getPortalSession }        from '@/app/actions/portal/auth'
import ImportarWizard              from './ImportarWizard'

export const dynamic = 'force-dynamic'

// Herramienta interna del equipo: SOLO en modo configuración (impersonación).
// No se declara en el sidebar; se entra desde el banner de impersonación.
export default async function ImportarPage() {
  const session = await getPortalSession()
  if (!session)      redirect('/portal/login')
  if (!session.imp)  redirect('/portal/dashboard')

  // Empresas, monedas y demás valores globales los resuelve cada entidad al
  // elegirla (`obtenerCamposEntidad`), no esta página.
  return <ImportarWizard />
}
