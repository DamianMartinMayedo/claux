import { notFound }         from 'next/navigation'
import { requireModulo }     from '@/app/actions/portal/auth'
import { obtenerCajaConfig } from '@/app/actions/portal/caja'
import CajaConfigView        from './CajaConfigView'

export const dynamic = 'force-dynamic'

export default async function CajaConfigPage({ params }: { params: Promise<{ caja_id: string }> }) {
  await requireModulo('caja')
  const { caja_id } = await params
  const data = await obtenerCajaConfig(caja_id)
  if (!data) notFound()
  return <CajaConfigView data={data} />
}
