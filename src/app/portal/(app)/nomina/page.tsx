import { notFound }      from 'next/navigation'
import { requireModulo } from '@/app/actions/portal/auth'
import { obtenerRrhh }   from '@/app/actions/portal/rrhh'
import NominaView        from './NominaView'

export const dynamic = 'force-dynamic'

export default async function NominaPage({
  searchParams,
}: {
  searchParams: Promise<{ nomina_id?: string }>
}) {
  await requireModulo('rrhh')
  const data = await obtenerRrhh()
  if (!data) notFound()
  const { nomina_id } = await searchParams
  return <NominaView data={data} focusNominaId={nomina_id} />
}
