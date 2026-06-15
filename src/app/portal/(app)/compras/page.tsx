import { requireModulo } from '@/app/actions/portal/auth'
import EnConstruccion from '@/components/portal/EnConstruccion'

export default async function ComprasPage() {
  await requireModulo('inventario')
  return <EnConstruccion titulo="Compras" subtitulo="Gestión de compras y proveedores." />
}
