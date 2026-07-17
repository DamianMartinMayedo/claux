import { redirect }        from 'next/navigation'
import { getPortalSession } from '@/app/actions/portal/auth'
import { obtenerPerfil }    from '@/app/actions/portal/perfil'
import { obtenerPanelIa }   from '@/app/actions/portal/ia'
import { obtenerAsesores }  from '@/app/actions/portal/asesores'
import { obtenerEmpresas }  from '@/app/actions/portal/empresas'
import PerfilView           from './PerfilView'

export const dynamic = 'force-dynamic'

export default async function PerfilPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const [perfil, panelIa, asesores, empresas] = await Promise.all([
    obtenerPerfil(), obtenerPanelIa(), obtenerAsesores(), obtenerEmpresas(),
  ])
  if (!perfil) redirect('/portal/login')

  return (
    <PerfilView
      perfil={perfil}
      panelIa={panelIa}
      asesores={asesores}
      empresas={empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre }))}
    />
  )
}
