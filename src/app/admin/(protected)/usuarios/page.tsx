import { requireAccesoPagina } from '@/lib/admin-guard'
import { listarUsuariosAdmin } from '@/app/actions/usuarios-admin'
import UsuariosView from './UsuariosView'

export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  await requireAccesoPagina('usuarios')
  const usuarios = await listarUsuariosAdmin()
  return <UsuariosView usuarios={usuarios} />
}
