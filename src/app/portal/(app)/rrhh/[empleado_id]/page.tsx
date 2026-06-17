import { notFound }              from 'next/navigation'
import { requireModulo }         from '@/app/actions/portal/auth'
import { obtenerEmpleadoDetalle } from '@/app/actions/portal/rrhh'
import EmpleadoDetalleView        from './EmpleadoDetalleView'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ empleado_id: string }>
}

export default async function EmpleadoDetallePage({ params }: Props) {
  await requireModulo('rrhh')
  const { empleado_id } = await params
  const detalle = await obtenerEmpleadoDetalle(empleado_id)
  if (!detalle) notFound()
  return <EmpleadoDetalleView detalle={detalle} />
}
