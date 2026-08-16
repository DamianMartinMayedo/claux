import { notFound }                 from 'next/navigation'
import { requireAccesoModulo }       from '@/app/actions/portal/auth'
import { obtenerCuentasPorCobrar } from '@/app/actions/portal/cobranza'
import CuentasView                  from '@/components/portal/CuentasView'

export const dynamic = 'force-dynamic'

export default async function CxCPage() {
  const { puedeEditar } = await requireAccesoModulo('base')
  const data = await obtenerCuentasPorCobrar()
  if (!data) notFound()
  return <CuentasView data={data} puedeEditar={puedeEditar} />
}
