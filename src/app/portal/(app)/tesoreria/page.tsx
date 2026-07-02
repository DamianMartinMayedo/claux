import { notFound }         from 'next/navigation'
import { requireModulo }     from '@/app/actions/portal/auth'
import { obtenerTesoreria } from '@/app/actions/portal/tesoreria'
import { obtenerCuentasPorCobrar, obtenerCuentasPorPagar } from '@/app/actions/portal/cobranza'
import TesoreriaView        from './TesoreriaView'

export const dynamic = 'force-dynamic'

export default async function TesoreriaPage() {
  await requireModulo('base')
  const [data, cxc, cxp] = await Promise.all([
    obtenerTesoreria(),
    obtenerCuentasPorCobrar(),
    obtenerCuentasPorPagar(),
  ])
  if (!data) notFound()
  return (
    <TesoreriaView
      data={data}
      pendientes={{ cobrar: cxc?.documentos ?? [], pagar: cxp?.documentos ?? [] }}
    />
  )
}
