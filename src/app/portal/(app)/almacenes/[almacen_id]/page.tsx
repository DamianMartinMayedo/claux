import { notFound } from 'next/navigation'
import { requireModulo } from '@/app/actions/portal/auth'
import { obtenerAlmacenDetalle } from '@/app/actions/portal/almacenes'
import { obtenerConteosDeAlmacen } from '@/app/actions/portal/conteos'
import { TOPE_VER_MAS } from '@/lib/listados'
import AlmacenDetalle from './AlmacenDetalle'

export const dynamic = 'force-dynamic'

export default async function AlmacenDetallePage({
  params, searchParams,
}: {
  params: Promise<{ almacen_id: string }>
  searchParams: Promise<{ limite?: string }>
}) {
  await requireModulo('inventario')
  const { almacen_id } = await params
  // `limite` lo sube «Traer más». Las dos pestañas con historia (movimientos y conteos)
  // recortaban en el techo: una avisaba sin decir cuántos faltaban y la otra no avisaba.
  const { limite } = await searchParams
  const pedido = Number(limite)
  const tope = Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, TOPE_VER_MAS) : undefined
  // En paralelo: son dos lecturas independientes, y encadenarlas es una ida y vuelta
  // regalada en una conexión donde cada una se nota.
  const [data, conteos] = await Promise.all([
    obtenerAlmacenDetalle(almacen_id, { limite: tope }),
    obtenerConteosDeAlmacen(almacen_id, { limite: tope }),
  ])
  if (!data) notFound()
  return <AlmacenDetalle data={data} conteos={conteos} />
}
