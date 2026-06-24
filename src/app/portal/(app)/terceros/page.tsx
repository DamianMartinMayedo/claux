import { redirect }        from 'next/navigation'
import { requireModulo }    from '@/app/actions/portal/auth'
import { obtenerTerceros }  from '@/app/actions/portal/terceros'
import TercerosView         from './TercerosView'

export const dynamic = 'force-dynamic'

export default async function TercerosPage() {
  await requireModulo('base')
  const data = await obtenerTerceros()
  if (!data) redirect('/portal/login')
  return <TercerosView data={data} />
}
