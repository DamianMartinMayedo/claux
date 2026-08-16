import { notFound }            from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerPersonal } from '@/app/actions/portal/rrhh'
import ContabilidadHint   from '@/components/portal/ContabilidadHint'
import PersonalView       from './PersonalView'
import SolicitarAcceso     from '@/components/portal/SolicitarAcceso'

export const dynamic = 'force-dynamic'

export default async function RrhhPage() {
  const { puedeEditar } = await requireAccesoModulo('rrhh')
  const data = await obtenerPersonal()
  if (!data) notFound()
  return (
    <>
      <PersonalView data={data} puedeEditar={puedeEditar}>
        {!puedeEditar && <SolicitarAcceso modulo="rrhh" />}
      </PersonalView>
      <ContabilidadHint genera="tus nóminas" />
    </>
  )
}
