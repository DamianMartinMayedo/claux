import { notFound }              from 'next/navigation'
import { requireAccesoModulo }   from '@/app/actions/portal/auth'
import { obtenerEmpleadoDetalle } from '@/app/actions/portal/rrhh'
import EmpleadoDetalleView        from './EmpleadoDetalleView'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ empleado_id: string }>
}

export default async function EmpleadoDetallePage({ params }: Props) {
  const { puedeEditar } = await requireAccesoModulo('rrhh')
  const { empleado_id } = await params
  const detalle = await obtenerEmpleadoDetalle(empleado_id)
  if (!detalle) notFound()
  return <EmpleadoDetalleView detalle={detalle} puedeEditar={puedeEditar} />
}
