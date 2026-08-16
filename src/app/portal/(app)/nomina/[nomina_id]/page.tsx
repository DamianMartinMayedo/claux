import { notFound }             from 'next/navigation'
import { requireAccesoModulo }  from '@/app/actions/portal/auth'
import { obtenerNominaDetalle } from '@/app/actions/portal/rrhh'
import NominaDetalleView        from './NominaDetalleView'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ nomina_id: string }>
}

export default async function NominaDetallePage({ params }: Props) {
  const { puedeEditar } = await requireAccesoModulo('rrhh')
  const { nomina_id } = await params
  const detalle = await obtenerNominaDetalle(nomina_id)
  if (!detalle) notFound()
  return <NominaDetalleView detalle={detalle} tienePermiso={puedeEditar} />
}
