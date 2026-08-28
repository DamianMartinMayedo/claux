import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { listarCajas, saludCajas } from '@/app/actions/portal/caja'
import { obtenerEmpresas }   from '@/app/actions/portal/empresas'
import CajaHubView           from './CajaHubView'
import SolicitarAcceso       from '@/components/portal/SolicitarAcceso'
import CupoNivel from '@/components/portal/CupoNivel'

export const dynamic = 'force-dynamic'

export default async function CajaPage() {
  const { puedeEditar } = await requireAccesoModulo('caja')
  const [cajas, empresas, salud] = await Promise.all([listarCajas(), obtenerEmpresas(), saludCajas()])
  return (
    <CajaHubView
      cajas={cajas}
      empresas={empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre }))}
      salud={salud}
      puedeEditar={puedeEditar}
    >
      <CupoNivel dim="puntos_venta" />
      {!puedeEditar && <SolicitarAcceso modulo="caja" />}
    </CajaHubView>
  )
}
