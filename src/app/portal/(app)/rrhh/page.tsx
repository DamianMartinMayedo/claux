import { notFound }       from 'next/navigation'
import { requireModulo }  from '@/app/actions/portal/auth'
import { obtenerRrhh }    from '@/app/actions/portal/rrhh'
import ContabilidadHint   from '@/components/portal/ContabilidadHint'
import PersonalView       from './PersonalView'

export const dynamic = 'force-dynamic'

export default async function RrhhPage() {
  await requireModulo('rrhh')
  const data = await obtenerRrhh()
  if (!data) notFound()
  return (
    <>
      <ContabilidadHint genera="tus nóminas" />
      <PersonalView data={data} />
    </>
  )
}
