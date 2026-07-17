import { redirect }           from 'next/navigation'
import { requireAlgunModulo }  from '@/app/actions/portal/auth'
import { obtenerTerceros }     from '@/app/actions/portal/terceros'
import TercerosView            from './TercerosView'

export const dynamic = 'force-dynamic'

export default async function TercerosPage() {
  // Clientes y proveedores lo necesitan Contabilidad (facturas, CxC/CxP) e
  // Inventario (compras, productos). Se abre con cualquiera de los dos.
  await requireAlgunModulo(['base', 'inventario'])
  const data = await obtenerTerceros()
  if (!data) redirect('/portal/login')
  return <TercerosView data={data} />
}
