import { notFound }                from 'next/navigation'
import { requireAccesoModulo }      from '@/app/actions/portal/auth'
import { obtenerCuentasPorPagar } from '@/app/actions/portal/cobranza'
import CuentasView                 from '@/components/portal/CuentasView'

export const dynamic = 'force-dynamic'

export default async function CxPPage() {
  const { puedeEditar } = await requireAccesoModulo('base')
  const data = await obtenerCuentasPorPagar()
  if (!data) notFound()
  return <CuentasView data={data} puedeEditar={puedeEditar} />
}
