import { redirect }        from 'next/navigation'
import { obtenerTerceros }  from '@/app/actions/portal/terceros'
import TercerosView         from './TercerosView'

export const dynamic = 'force-dynamic'

export default async function TercerosPage() {
  const data = await obtenerTerceros()
  if (!data) redirect('/portal/login')
  return <TercerosView data={data} />
}
