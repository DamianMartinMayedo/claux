import { notFound }            from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerTurnos }       from '@/app/actions/portal/rrhh'
import TurnosView              from './TurnosView'
import SolicitarAcceso          from '@/components/portal/SolicitarAcceso'

export const dynamic = 'force-dynamic'

export default async function TurnosPage() {
  const { puedeEditar } = await requireAccesoModulo('rrhh')
  const data = await obtenerTurnos()
  if (!data) notFound()
  return (
    <TurnosView data={data} puedeEditar={puedeEditar}>
      {!puedeEditar && <SolicitarAcceso modulo="rrhh" />}
    </TurnosView>
  )
}
