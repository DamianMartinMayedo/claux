import { notFound }            from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerGastosCobros } from '@/app/actions/portal/gastos'
import GastosView              from './GastosView'

export const dynamic = 'force-dynamic'

export default async function GastosPage() {
  const { puedeEditar } = await requireAccesoModulo('base')
  const data = await obtenerGastosCobros()
  if (!data) notFound()
  return <GastosView data={data} puedeEditar={puedeEditar} />
}
