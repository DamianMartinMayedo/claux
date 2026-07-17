import { requireModulo }   from '@/app/actions/portal/auth'
import { obtenerAsesores } from '@/app/actions/portal/asesores'
import { obtenerEmpresas } from '@/app/actions/portal/empresas'
import AsesoresView        from './AsesoresView'

export const dynamic = 'force-dynamic'

// Directorio de asesores. Gateado por `base` (Contabilidad): la funcionalidad de
// enviarles los reportes vive en ese módulo, así que sin él no tiene sentido.
export default async function AsesoresPage() {
  await requireModulo('base')
  const [asesores, empresas] = await Promise.all([obtenerAsesores(), obtenerEmpresas()])
  return (
    <AsesoresView
      asesores={asesores}
      empresas={empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre }))}
    />
  )
}
