import { notFound }            from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerAlmacenes }    from '@/app/actions/portal/almacenes'
import AlmacenesView           from './AlmacenesView'
import SolicitarAcceso          from '@/components/portal/SolicitarAcceso'

export const dynamic = 'force-dynamic'

export default async function AlmacenesPage() {
  const { puedeEditar } = await requireAccesoModulo('inventario')
  const data = await obtenerAlmacenes()
  if (!data) notFound()
  return (
    <AlmacenesView data={data} puedeEditar={puedeEditar}>
      {!puedeEditar && <SolicitarAcceso modulo="inventario" />}
    </AlmacenesView>
  )
}
