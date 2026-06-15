import { requireModulo } from '@/app/actions/portal/auth'
import EnConstruccion from '@/components/portal/EnConstruccion'

export default async function InventarioPage() {
  await requireModulo('inventario')
  return <EnConstruccion titulo="Inventario" subtitulo="Stock y movimientos de almacén." />
}
