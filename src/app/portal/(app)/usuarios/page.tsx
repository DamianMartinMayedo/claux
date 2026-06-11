import { redirect }           from 'next/navigation'
import { getPortalSession }   from '@/app/actions/portal/auth'
import { obtenerUsuarios }    from '@/app/actions/portal/usuarios'
import { obtenerEmpresas }    from '@/app/actions/portal/empresas'
import UsuariosView           from './UsuariosView'

export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')
  if (session.rol !== 'admin_empresa') redirect('/portal/empresas')

  const [usuarios, empresas] = await Promise.all([
    obtenerUsuarios(),
    obtenerEmpresas(),
  ])

  return (
    <UsuariosView
      usuarios={usuarios}
      empresas={empresas}
      sessionUserId={session.user_id}
      soloLectura={session.solo_lectura}
    />
  )
}
