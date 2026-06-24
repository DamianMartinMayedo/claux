import { notFound }                 from 'next/navigation'
import { requireModulo }             from '@/app/actions/portal/auth'
import { obtenerCuentasPorCobrar } from '@/app/actions/portal/cobranza'
import CuentasView                  from '@/components/portal/CuentasView'

export const dynamic = 'force-dynamic'

export default async function CxCPage() {
  await requireModulo('base')
  const data = await obtenerCuentasPorCobrar()
  if (!data) notFound()
  return <CuentasView data={data} />
}
