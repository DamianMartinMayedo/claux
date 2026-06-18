import { notFound }            from 'next/navigation'
import { requireModulo }       from '@/app/actions/portal/auth'
import { obtenerCompraDetalle } from '@/app/actions/portal/compras'
import CompraDetalle           from './CompraDetalle'

export const dynamic = 'force-dynamic'

export default async function CompraDetallePage({
  params,
}: {
  params: Promise<{ compra_id: string }>
}) {
  await requireModulo('inventario')
  const { compra_id } = await params
  const data = await obtenerCompraDetalle(compra_id)
  if (!data) notFound()
  return <CompraDetalle data={data} />
}
