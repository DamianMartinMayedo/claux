import { notFound }            from 'next/navigation'
import { obtenerGastosCobros } from '@/app/actions/portal/gastos'
import GastosView              from './GastosView'

export const dynamic = 'force-dynamic'

export default async function GastosPage() {
  const data = await obtenerGastosCobros()
  if (!data) notFound()
  return <GastosView data={data} />
}
