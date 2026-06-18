import { requireModulo }  from '@/app/actions/portal/auth'
import { obtenerCompras } from '@/app/actions/portal/compras'
import EnConstruccion     from '@/components/portal/EnConstruccion'
import ComprasView        from './ComprasView'

export const dynamic = 'force-dynamic'

export default async function ComprasPage() {
  await requireModulo('inventario')
  const data = await obtenerCompras()
  if (!data) {
    return <EnConstruccion titulo="Compras" subtitulo="Gestión de compras y proveedores." />
  }
  return <ComprasView data={data} />
}
