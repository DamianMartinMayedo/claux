import { notFound } from 'next/navigation'
import { requireModulo } from '@/app/actions/portal/auth'
import { obtenerAlmacenDetalle } from '@/app/actions/portal/almacenes'
import { obtenerConteosDeAlmacen } from '@/app/actions/portal/conteos'
import AlmacenDetalle from './AlmacenDetalle'

export const dynamic = 'force-dynamic'

export default async function AlmacenDetallePage({
  params,
}: {
  params: Promise<{ almacen_id: string }>
}) {
  await requireModulo('inventario')
  const { almacen_id } = await params
  // En paralelo: son dos lecturas independientes, y encadenarlas es una ida y vuelta
  // regalada en una conexión donde cada una se nota.
  const [data, conteos] = await Promise.all([
    obtenerAlmacenDetalle(almacen_id),
    obtenerConteosDeAlmacen(almacen_id),
  ])
  if (!data) notFound()
  return <AlmacenDetalle data={data} conteos={conteos} />
}
