import { notFound }         from 'next/navigation'
import { requireModulo }     from '@/app/actions/portal/auth'
import { obtenerTesoreria } from '@/app/actions/portal/tesoreria'
import { obtenerCuentasPorCobrar, obtenerCuentasPorPagar } from '@/app/actions/portal/cobranza'
import TesoreriaView        from './TesoreriaView'

export const dynamic = 'force-dynamic'

export default async function TesoreriaPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; q?: string }>
}) {
  await requireModulo('base')
  // El rango acota el LISTADO de movimientos, no los saldos: un saldo es la suma de toda
  // la historia de la cuenta y filtrarlo sería enseñar un saldo que no existe.
  const { desde, hasta, q } = await searchParams
  const [data, cxc, cxp] = await Promise.all([
    obtenerTesoreria({ desde, hasta, q }),
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
