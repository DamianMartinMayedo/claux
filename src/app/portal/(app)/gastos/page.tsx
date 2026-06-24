import { notFound }            from 'next/navigation'
import { requireModulo }        from '@/app/actions/portal/auth'
import { obtenerGastosCobros } from '@/app/actions/portal/gastos'
import GastosView              from './GastosView'

export const dynamic = 'force-dynamic'

export default async function GastosPage() {
  await requireModulo('base')
  const data = await obtenerGastosCobros()
  if (!data) notFound()
  return <GastosView data={data} />
}
