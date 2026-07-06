import { notFound } from 'next/navigation'
import { requireModulo } from '@/app/actions/portal/auth'
import { obtenerCatalogo } from '@/app/actions/portal/catalogo'
import ItemDetalleView from './ItemDetalleView'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ itemId: string }>
}

export default async function CatalogoItemPage({ params }: Props) {
  await requireModulo('catalogo_qr')
  const { itemId } = await params
  const data = await obtenerCatalogo()
  if (!data) notFound()
  const item = data.items.find(i => i.item_id === itemId)
  if (!item) notFound()

  return <ItemDetalleView data={data} item={item} />
}
