import { redirect }           from 'next/navigation'
import { getPortalSession }   from '@/app/actions/portal/auth'
import { obtenerUsuarios }    from '@/app/actions/portal/usuarios'
import { obtenerEmpresas }    from '@/app/actions/portal/empresas'
import { createAdminClient }  from '@/lib/supabase/admin'
import UsuariosView, { type ModuloContratado } from './UsuariosView'

export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')
  if (session.rol !== 'admin_empresa') redirect('/portal/empresas')

  const db = createAdminClient()

  const [usuarios, empresas, { data: cliente }, { data: catalogo }] = await Promise.all([
    obtenerUsuarios(),
    obtenerEmpresas(),
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).single(),
    db.from('modulos_catalogo').select('clave, nombre, tipo, orden').eq('activo', true).order('orden'),
  ])

  // Módulos que el tenant tiene contratados (catálogo ∩ modulos_activos). Son los
  // que el admin puede repartir por usuario. Cualquier tipo (módulo/funcionalidad/addon).
  const activos: string[] = Array.isArray(cliente?.modulos_activos)
    ? (cliente.modulos_activos as string[])
    : []
  const modulosContratados: ModuloContratado[] = (catalogo ?? [])
    .filter(c => activos.includes(c.clave))
    .map(c => ({ clave: c.clave, nombre: c.nombre, tipo: c.tipo as ModuloContratado['tipo'] }))

  return (
    <UsuariosView
      usuarios={usuarios}
      empresas={empresas}
      sessionUserId={session.user_id}
      soloLectura={session.solo_lectura}
      modulosContratados={modulosContratados}
    />
  )
}
