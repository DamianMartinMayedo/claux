import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerAsesores } from '@/app/actions/portal/asesores'
import { obtenerEmpresas } from '@/app/actions/portal/empresas'
import AsesoresView        from './AsesoresView'
import SolicitarAcceso      from '@/components/portal/SolicitarAcceso'

export const dynamic = 'force-dynamic'

// Directorio de asesores. Gateado por `base` (Contabilidad): la funcionalidad de
// enviarles los reportes vive en ese módulo, así que sin él no tiene sentido.
export default async function AsesoresPage() {
  const { puedeEditar } = await requireAccesoModulo('base')
  const [asesores, empresas] = await Promise.all([obtenerAsesores(), obtenerEmpresas()])
  return (
    <AsesoresView
      asesores={asesores}
      empresas={empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre }))}
      puedeEditar={puedeEditar}
    >
      {!puedeEditar && <SolicitarAcceso modulo="base" />}
    </AsesoresView>
  )
}
