import { redirect }            from 'next/navigation'
import { getPortalSession }    from '@/app/actions/portal/auth'
import { obtenerMonedas, obtenerPares } from '@/app/actions/portal/monedas'
import MonedasView             from './MonedasView'

export const dynamic = 'force-dynamic'

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
