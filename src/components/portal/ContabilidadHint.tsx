import { Info } from 'lucide-react'
import { getPortalSession } from '@/app/actions/portal/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { tieneModulo } from '@/lib/modulos'

// Aviso orientativo (no bloqueante) para módulos que generan apuntes contables
// —Inventario (compras) y RRHH (nóminas)— cuando el cliente NO tiene contratada
// la Contabilidad. No fuerza ninguna dependencia: solo informa de que con el
// módulo vería esos gastos/pagos reflejados. Si tiene Contabilidad, no aparece.
export default async function ContabilidadHint({ genera }: { genera: string }) {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const { data } = await db
    .from('clients')
    .select('modulos_activos')
    .eq('client_id', session.client_id)
    .single()

  if (tieneModulo(data?.modulos_activos, 'base')) return null

  return (
    <div className="info-banner">
      <Info aria-hidden />
      <p>
        <strong>Saca más partido con Contabilidad</strong>
        Con el módulo de Contabilidad verías los gastos y pagos que generan {genera}{' '}
        reflejados en tus cuentas y tesorería, todo en un mismo sitio.
      </p>
    </div>
  )
}
