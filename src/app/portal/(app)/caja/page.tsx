import { requireModulo }    from '@/app/actions/portal/auth'
import { listarCajas }       from '@/app/actions/portal/caja'
import { obtenerEmpresas }   from '@/app/actions/portal/empresas'
import CajaHubView           from './CajaHubView'

export const dynamic = 'force-dynamic'

export default async function CajaPage() {
  await requireModulo('caja')
  const [cajas, empresas] = await Promise.all([listarCajas(), obtenerEmpresas()])
  return <CajaHubView cajas={cajas} empresas={empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre }))} />
}
