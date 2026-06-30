import { redirect }        from 'next/navigation'
import { getPortalSession } from '@/app/actions/portal/auth'
import { obtenerPerfil }    from '@/app/actions/portal/perfil'
import { obtenerPanelIa }   from '@/app/actions/portal/ia'
import PerfilView           from './PerfilView'

export const dynamic = 'force-dynamic'

export default async function PerfilPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const [perfil, panelIa] = await Promise.all([obtenerPerfil(), obtenerPanelIa()])
  if (!perfil) redirect('/portal/login')

  return <PerfilView perfil={perfil} panelIa={panelIa} />
}
