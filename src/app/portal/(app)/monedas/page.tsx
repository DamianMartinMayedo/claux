import { redirect }            from 'next/navigation'
import { getPortalSession }    from '@/app/actions/portal/auth'
import { obtenerMonedas, obtenerPares } from '@/app/actions/portal/monedas'
import MonedasView             from './MonedasView'

export const dynamic = 'force-dynamic'

// Monedas y tasas es configuración transversal (la usan Ventas, Compras, Gastos,
// Tesorería, Inventario y RRHH). Vive en el menú de cuenta y está disponible para
// cualquier usuario con sesión, sin requireModulo.
export default async function MonedasPage() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const [monedas, pares] = await Promise.all([
    obtenerMonedas(),
    obtenerPares(),
  ])

  return (
    <MonedasView
      monedas={monedas}
      pares={pares}
      esAdmin={session.rol === 'admin_empresa'}
    />
  )
}
