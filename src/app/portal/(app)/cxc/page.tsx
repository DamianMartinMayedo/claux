import { notFound }                 from 'next/navigation'
import { obtenerCuentasPorCobrar } from '@/app/actions/portal/cobranza'
import CuentasView                  from '@/components/portal/CuentasView'

export const dynamic = 'force-dynamic'

export default async function CxCPage() {
  const data = await obtenerCuentasPorCobrar()
  if (!data) notFound()
  return <CuentasView data={data} />
}
